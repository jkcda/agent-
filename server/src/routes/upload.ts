import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import config from '../config/index.js'
import { ApiResponse } from '../utils/response.js'

const router = express.Router()

const uploadsDir = path.join(process.cwd(), 'uploads')

// 确保上传目录存在
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// multer 底层 busboy 按 latin1 解析文件名，中文会乱码，需转回 UTF-8
function decodeFileName(originalname: string): string {
  return Buffer.from(originalname, 'latin1').toString('utf8')
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    const originalName = decodeFileName(file.originalname)
    const ext = path.extname(originalName)
    const baseName = path.basename(originalName, ext)
    const timestamp = Date.now()
    const safeName = `${baseName}_${timestamp}${ext}`
    cb(null, safeName)
  }
})

function fileFilter(_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const isImage = config.upload.allowedImages.includes(file.mimetype)
  const isDoc = config.upload.allowedDocs.includes(file.mimetype)
  if (isImage || isDoc) {
    cb(null, true)
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Math.max(config.upload.maxImageSize, config.upload.maxDocSize)
  }
})

// POST /api/upload - 上传文件
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, '请选择要上传的文件')
    }

    const file = req.file
    const url = `/uploads/${file.filename}`

    ApiResponse.success(res, {
      name: decodeFileName(file.originalname),
      url,
      type: file.mimetype,
      size: file.size
    }, '上传成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '上传失败', error.message)
  }
})

// POST /api/upload/avatar - 上传角色头像
const avatarDir = path.join(process.cwd(), 'uploads', 'avatars')
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const originalName = decodeFileName(file.originalname)
    const ext = path.extname(originalName)
    cb(null, `avatar_${Date.now()}${ext}`)
  }
})

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: (_req, file, cb) => {
    if (config.upload.allowedImages.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('仅支持图片格式'))
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
})

router.post('/upload/avatar', avatarUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, '请选择头像图片')
    const url = `/uploads/avatars/${req.file.filename}`
    ApiResponse.success(res, { name: decodeFileName(req.file.originalname), url }, '上传成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '上传失败', error.message)
  }
})

// multer 错误处理
router.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return ApiResponse.badRequest(res, '文件大小超出限制')
    }
    return ApiResponse.badRequest(res, err.message)
  }
  if (err) {
    return ApiResponse.badRequest(res, err.message)
  }
  next()
})

export default router
