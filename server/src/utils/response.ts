import { Response } from 'express'

/**
 * API 响应工具类
 * 统一处理 HTTP 状态码和响应格式
 */
export class ApiResponse {
  /**
   * 成功响应
   * @param res Express Response 对象
   * @param data 返回的数据
   * @param message 成功消息
   * @param statusCode HTTP 状态码（默认 200）
   */
  static success<T>(
    res: Response,
    data: T,
    message?: string,
    statusCode: number = 200
  ): Response {
    return res.status(statusCode).json({
      success: true,
      message: message || '操作成功',
      result: data
    })
  }

  /**
   * 创建成功响应（201）
   * @param res Express Response 对象
   * @param data 返回的数据
   * @param message 成功消息
   */
  static created<T>(
    res: Response,
    data: T,
    message: string = '创建成功'
  ): Response {
    return this.success(res, data, message, 201)
  }

  /**
   * 错误响应
   * @param res Express Response 对象
   * @param message 错误消息
   * @param statusCode HTTP 状态码（默认 400）
   * @param error 错误详情
   */
  static error(
    res: Response,
    message: string,
    statusCode: number = 400,
    error?: string
  ): Response {
    return res.status(statusCode).json({
      success: false,
      message,
      error: error || null
    })
  }

  /**
   * 400 错误 - 客户端错误
   * @param res Express Response 对象
   * @param message 错误消息
   */
  static badRequest(res: Response, message: string): Response {
    return this.error(res, message, 400)
  }

  /**
   * 401 错误 - 未授权
   * @param res Express Response 对象
   * @param message 错误消息
   */
  static unauthorized(res: Response, message: string = '未授权'): Response {
    return this.error(res, message, 401)
  }

  /**
   * 403 错误 - 禁止访问
   * @param res Express Response 对象
   * @param message 错误消息
   */
  static forbidden(res: Response, message: string = '禁止访问'): Response {
    return this.error(res, message, 403)
  }

  /**
   * 404 错误 - 资源不存在
   * @param res Express Response 对象
   * @param message 错误消息
   */
  static notFound(res: Response, message: string = '资源不存在'): Response {
    return this.error(res, message, 404)
  }

  /**
   * 500 错误 - 服务器内部错误
   * @param res Express Response 对象
   * @param message 错误消息
   * @param error 错误详情
   */
  static internalServerError(
    res: Response,
    message: string = '服务器内部错误',
    error?: string
  ): Response {
    return this.error(res, message, 500, error)
  }

  /**
   * 空响应（无数据返回）
   * @param res Express Response 对象
   * @param message 消息
   * @param statusCode HTTP 状态码（默认 200）
   */
  static noContent(
    res: Response,
    message?: string,
    statusCode: number = 200
  ): Response {
    return res.status(statusCode).json({
      success: true,
      message: message || '操作成功',
      result: null
    })
  }
}
