import type { UnifiedErrorCode } from './codes'

export const USER_ERROR_MESSAGES_ZH: Record<UnifiedErrorCode, string> = {
  UNAUTHORIZED: '请先登录后再试。',
  FORBIDDEN: '你没有权限执行此操作。',
  NOT_FOUND: '没有找到对应的数据。',
  INVALID_PARAMS: '请求参数不正确，请检查后重试。',
  MISSING_CONFIG: '系统配置不完整，请联系管理员。',
  EPISODE_NO_CLIPS: '此集還沒有劇本切塊 — 請先到「劇本」步驟上傳或寫入劇本，等劇本分析完成後再回來分鏡。',
  TASK_STILL_PROCESSING: '上一個任務還在處理中，請等幾秒讓它跑完再重試。重複按按鈕不會加速。',
  CONFLICT: '当前状态冲突，请刷新后重试。',
  TASK_NOT_READY: '任务还在处理中，请稍后。',
  NO_RESULT: '任务已完成，但没有可用结果。',
  RATE_LIMIT: '请求过于频繁，请稍后重试。',
  QUOTA_EXCEEDED: '额度已用尽，请稍后再试。',
  EXTERNAL_ERROR: '外部服务暂时不可用，请稍后重试。',
  NETWORK_ERROR: '网络异常，请稍后重试。',
  INSUFFICIENT_BALANCE: '余额不足，请先充值。',
  SENSITIVE_CONTENT: '内容被供应商的内容审核挡下（可能含敏感信息）。请调整叙事 / 角色 / 场景内容后重试；若是「输出音频」被挡，可关闭「音频」后重新生成。',
  ARK_FACE_DETECTED: '火山 Seedance 2.0 不接受未报备的真人臉参考图。請到該角色 / 場景 / 道具的編輯面板按「报备火山」，等狀態變綠後再重新生成。',
  ARK_SUBSCRIPTION_REQUIRED: '火山方舟素材庫 API 需先購買「Seedance 2.0 高级创作权益包」才能使用。請至火山控制台訂閱後再試。',
  GENERATION_TIMEOUT: '生成超时，请重试。',
  GENERATION_FAILED: '生成失败，请稍后重试。',
  WATCHDOG_TIMEOUT: '任务执行超时，系统已终止该任务。',
  WORKER_EXECUTION_ERROR: '任务执行失败，请稍后重试。',
  INTERNAL_ERROR: '系统内部错误，请稍后重试。',
}

export function getUserMessageByCode(code: UnifiedErrorCode) {
  return USER_ERROR_MESSAGES_ZH[code]
}
