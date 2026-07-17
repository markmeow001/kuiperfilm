import { describe, expect, it } from 'vitest'
import { dataUrlToImageFile } from '../../../src/components/shared/assets/character-creation/character-upload-utils'

describe('character upload utils', () => {
  it('[上傳四視圖 Data URL] -> [保留圖片 bytes 與 MIME 並轉成 multipart File]', async () => {
    const file = dataUrlToImageFile('data:image/png;base64,aGVsbG8=', '角色A.png')

    expect(file.name).toBe('角色A.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(5)
    expect(await file.text()).toBe('hello')
  })

  it('[不是圖片 Data URL] -> [明確拒絕，避免送出損壞檔案]', () => {
    expect(() => dataUrlToImageFile('data:text/plain;base64,aGVsbG8=', 'bad.txt')).toThrow(
      'INVALID_IMAGE_DATA_URL',
    )
  })
})
