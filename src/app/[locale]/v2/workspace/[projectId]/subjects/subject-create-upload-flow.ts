export interface SubjectUploadTarget {
  createdId: string
  targetId: string
}

export function createSubjectUploadRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('SECURE_RANDOM_UUID_UNAVAILABLE')
  }
  return globalThis.crypto.randomUUID()
}

export type ResumableCreateWithUploadResult<Target extends SubjectUploadTarget> =
  | { status: 'completed'; target: Target }
  | { status: 'upload-failed'; target: Target; error: unknown }

interface RunResumableCreateWithUploadParams<Target extends SubjectUploadTarget> {
  existingTarget: Target | null
  createTarget: () => Promise<Target>
  onCreated: (target: Target) => Promise<void>
  uploadTarget: (target: Target) => Promise<void>
}

/**
 * Coordinates the non-atomic browser flow without losing the durable target.
 * A retry receives `existingTarget`, so it can only upload to the entity that
 * was already created and can never issue a second create request.
 */
export async function runResumableCreateWithUpload<Target extends SubjectUploadTarget>({
  existingTarget,
  createTarget,
  onCreated,
  uploadTarget,
}: RunResumableCreateWithUploadParams<Target>): Promise<ResumableCreateWithUploadResult<Target>> {
  const target = existingTarget ?? await createTarget()

  if (!existingTarget) {
    await onCreated(target)
  }

  try {
    await uploadTarget(target)
    return { status: 'completed', target }
  } catch (error: unknown) {
    return { status: 'upload-failed', target, error }
  }
}
