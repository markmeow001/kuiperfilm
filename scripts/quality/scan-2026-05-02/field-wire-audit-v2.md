# Field-wire audit v2 — 2026-05-02

Cross-references frontend mutation body keys ↔ API route reads.
Excludes V1 `[locale]/workspace/` tree, generic noise, JS reserved words.

## Counts

| Metric | Count |
| --- | ---: |
| frontend_keys_sent | 54 |
| api_keys_read | 155 |
| matched | 45 |
| sent_not_read | 9 |
| read_not_sent | 110 |

## SENT_NOT_READ — frontend sends but no API reads

9 keys appear in `body: JSON.stringify({...})` but no API route reads `body.X`.

**This is the highest-signal bucket.** A real positive here means:
- Field name typo on the server side (BUG)
- Field accidentally renamed mid-refactor (BUG)
- Server expected the field but the read line was deleted (BUG)

False-positive sources to ignore manually:
- Server destructures with rename: `const { sent: dbCol } = body` (escapes v2 scan)
- Server passes whole `body` object downstream without `.X` access
- Field consumed by middleware before reaching route handler

- `async` — sent from: src/lib/query/mutations/useProjectConfigMutations.ts
- `audioBase64` — sent from: src/lib/query/mutations/character-voice-mutations.ts
- `audio_url` — sent from: src/lib/kling.ts
- `characterName` — sent from: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts
- `delta` — sent from: src/app/[locale]/admin/users/page.tsx
- `locale` — sent from: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/locations/route.ts...
- `model` — sent from: src/lib/ark-llm.ts
- `quality` — sent from: src/features/video-editor/hooks/useEditorActions.ts
- `video_url` — sent from: src/lib/kling.ts

## READ_NOT_SENT — API reads but no frontend sends

110 keys read from `body.X` in some route but no frontend mutation
scanned sends them.

Likely causes (decreasing severity):
- Server reads it, sender is in `useStoryboards.ts` or other hook not via `body: JSON.stringify` pattern (regex miss)
- Sender uses `requestJsonWithError` / `requestTaskResponseWithError` helper that wraps body inside (regex miss)
- Genuinely dead API param — handler reads it but no caller (CLEANUP)
- Param read only when triggered from worker / cron / external system (BY DESIGN)

- `actingNotes` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `action` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `aliases` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `aspectRatio` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `audioModel` — routes: src/app/api/novel-promotion/[projectId]/voice-generate/route.ts
- `audioUrl` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts, src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts...
- `cameraMove` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `capabilityOverrides` — routes: src/app/api/novel-promotion/[projectId]/route.ts
- `changeReason` — routes: src/app/api/asset-hub/appearances/route.ts, src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts...
- `characterOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `characters` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts
- `clearExisting` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `clipId` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `composition` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `content` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts, src/app/api/novel-promotion/[projectId]/episodes/split-by-markers/route.ts...
- `count` — routes: src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts
- `currentPrompt` — routes: src/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route.ts
- `descriptionIndex` — routes: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `dialogue` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `direction` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `displayName` — routes: src/app/api/auth/register/route.ts
- `duration` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `editor` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `email` — routes: src/app/api/auth/register/route.ts
- `emotionPrompt` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `emotionStrength` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `episodeIds` — routes: src/app/api/novel-promotion/[projectId]/character/bind-appearance-bulk/route.ts
- `episodes` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `expires_hours` — routes: src/app/api/admin/invites/route.ts
- `firstLastFrame` — routes: src/app/api/novel-promotion/[projectId]/generate-video/route.ts
- `firstLastFramePrompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `generateFromReference` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts
- `generationOptions` — routes: src/app/api/novel-promotion/[projectId]/generate-video/route.ts
- `globalAssetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts
- `globalCharacterId` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `globalLocationId` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `globalVoiceId` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `importStatus` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `includeAppearances` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `includeImages` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `initialImageUrl` — routes: src/app/api/asset-hub/characters/route.ts
- `insertAfterPanelId` — routes: src/app/api/novel-promotion/[projectId]/insert-panel/route.ts, src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `insertIndex` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `intent` — routes: src/app/api/sse/route.ts
- `introduction` — routes: src/app/api/novel-promotion/[projectId]/character/route.ts
- `lineId` — routes: src/app/api/novel-promotion/[projectId]/voice-generate/route.ts, src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `linked` — routes: src/app/api/novel-promotion/[projectId]/panel-link/route.ts
- `lipSyncModel` — routes: src/app/api/novel-promotion/[projectId]/lip-sync/route.ts
- `location` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts
- `locationImageId` — routes: src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts
- `locationOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `matchedPanelId` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `metadata` — routes: src/app/api/novel-promotion/[projectId]/location/route.ts
- `modifyInstruction` — routes: src/app/api/asset-hub/ai-modify-character/route.ts, src/app/api/asset-hub/ai-modify-location/route.ts...
- `multiShotMode` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `newDescription` — routes: src/app/api/novel-promotion/[projectId]/update-appearance/route.ts, src/app/api/novel-promotion/[projectId]/update-location/route.ts
- `note` — routes: src/app/api/admin/invites/route.ts
- `novelText` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts
- `ownerEditorId` — routes: src/app/api/workspaces/[workspaceId]/route.ts
- `ownerUserId` — routes: src/app/api/organizations/[organizationId]/route.ts
- `panelDurations` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelIds` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelNumber` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `panelPreferences` — routes: src/app/api/novel-promotion/[projectId]/video-urls/route.ts
- `password` — routes: src/app/api/auth/register/route.ts
- `photographyPlan` — routes: src/app/api/novel-promotion/[projectId]/photography-plan/route.ts
- `photographyRules` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `preferredName` — routes: src/app/api/asset-hub/voice-design/route.ts, src/app/api/novel-promotion/[projectId]/voice-design/route.ts
- `previewText` — routes: src/app/api/asset-hub/voice-design/route.ts, src/app/api/novel-promotion/[projectId]/voice-design/route.ts
- `profileConfirmed` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `profileData` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `prompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `promptStyle` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `propId` — routes: src/app/api/novel-promotion/[projectId]/prop/route.ts
- `rawPrompt` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `referenceImageUrl` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/reference-to-character/route.ts...
- `scene` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `screenplay` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts
- `select` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `selectedAssets` — routes: src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `selectedImageUrl` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `shotId` — routes: src/app/api/novel-promotion/[projectId]/update-prompt/route.ts
- `shotType` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `sound` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `sourcePanelId` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `speaker` — routes: src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts, src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `srtContent` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts
- `srtEnd` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `srtSegment` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `srtStart` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `storyboard` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `subtitle` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `summary` — routes: src/app/api/asset-hub/locations/[locationId]/route.ts, src/app/api/asset-hub/locations/route.ts...
- `targetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts, src/app/api/runs/route.ts...
- `targetType` — routes: src/app/api/runs/route.ts, src/app/api/task-target-states/route.ts
- `targets` — routes: src/app/api/task-target-states/route.ts
- `taskId` — routes: src/app/api/runs/route.ts
- `taskIds` — routes: src/app/api/tasks/dismiss/route.ts
- `taskType` — routes: src/app/api/runs/route.ts
- `types` — routes: src/app/api/task-target-states/route.ts
- `ui` — routes: src/app/api/sse/route.ts
- `userId` — routes: src/app/api/workspaces/[workspaceId]/members/route.ts
- `userInstruction` — routes: src/app/api/asset-hub/ai-design-character/route.ts, src/app/api/asset-hub/ai-design-location/route.ts...
- `variant` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `videoModel` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts, src/app/api/novel-promotion/[projectId]/generate-video/route.ts
- `videoPrompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts, src/app/api/novel-promotion/[projectId]/safe-rewrite/route.ts
- `viewName` — routes: src/app/api/novel-promotion/[projectId]/location/view/route.ts
- `voiceDesign` — routes: src/app/api/asset-hub/character-voice/route.ts, src/app/api/novel-promotion/[projectId]/character-voice/route.ts
- `voicePresetId` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `workflowType` — routes: src/app/api/runs/route.ts
