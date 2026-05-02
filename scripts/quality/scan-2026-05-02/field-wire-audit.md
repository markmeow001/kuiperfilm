# Field-wire audit — 2026-05-02

Cross-references UI form fields ↔ API body params ↔ Prisma writes.

## Counts

| Metric | Count |
| --- | ---: |
| form_fields | 0 |
| api_params | 156 |
| prisma_writes | 64 |
| orphan_forms | 0 |
| orphan_api_in | 110 |
| write_no_form_or_api | 21 |

## Orphan form fields (UI only — no API consumer)

0 fields rendered as `<input name="X">` etc but no API route reads `body.X`.

Likely causes (decreasing severity):
- Field name mismatch between form and API (BUG)
- Field aliased on send (`{ X: y }` rename) — can be safe
- Form is purely client-side state (search box, filter UI)


## Orphan API params (read but never persisted)

110 params extracted from request body but no Prisma `data.X` write follows.

Likely causes:
- Param drives logic but not persistence (filter, mode, async flag) — usually safe
- Param renamed before write (`const dbX = X` then `data: { dbX: ... }`) — escapes scan
- Param is dead — UI sends it, server reads it, server drops it (BUG)

- `V2` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `action` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `all` — routes: src/app/api/novel-promotion/[projectId]/generate-video/route.ts, src/app/api/novel-promotion/[projectId]/voice-generate/route.ts
- `appearanceId` — routes: src/app/api/asset-hub/reference-to-character/route.ts, src/app/api/novel-promotion/[projectId]/ai-modify-appearance/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `aspectRatio` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `audioModel` — routes: src/app/api/novel-promotion/[projectId]/voice-generate/route.ts
- `audioUrl` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts, src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts, src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `base64` — routes: src/app/api/asset-hub/upload-temp/route.ts
- `capabilityDefaults` — routes: src/app/api/user/api-config/route.ts
- `capabilityOverrides` — routes: src/app/api/novel-promotion/[projectId]/route.ts
- `characterOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `clearExisting` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `clipId` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `composition` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `confirm` — routes: src/app/api/asset-hub/select-image/route.ts
- `count` — routes: src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts
- `currentDescription` — routes: src/app/api/novel-promotion/[projectId]/ai-modify-appearance/route.ts, src/app/api/novel-promotion/[projectId]/ai-modify-location/route.ts
- `currentPrompt` — routes: src/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route.ts
- `customDescription` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts
- `defaultModels` — routes: src/app/api/user/api-config/route.ts
- `descriptionIndex` — routes: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts, src/app/api/novel-promotion/[projectId]/update-appearance/route.ts
- `dialogue` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `direction` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `displayName` — routes: src/app/api/auth/register/route.ts
- `editor` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `editorProjectId` — routes: src/app/api/novel-promotion/[projectId]/editor/render/route.ts
- `email` — routes: src/app/api/auth/register/route.ts
- `emotionPrompt` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `emotionStrength` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `episodeIds` — routes: src/app/api/novel-promotion/[projectId]/character/bind-appearance-bulk/route.ts
- `episodes` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `expires_hours` — routes: src/app/api/admin/invites/route.ts
- `extension` — routes: src/app/api/asset-hub/upload-temp/route.ts
- `extraImageUrls` — routes: src/app/api/asset-hub/modify-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `false` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `field` — routes: src/app/api/novel-promotion/[projectId]/update-prompt/route.ts
- `firstLastFrame` — routes: src/app/api/novel-promotion/[projectId]/generate-video/route.ts
- `generateFromReference` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts
- `globalAssetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts
- `globalCharacterId` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `globalLocationId` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `globalVoiceId` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `imageBase64` — routes: src/app/api/asset-hub/upload-temp/route.ts
- `importStatus` — routes: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts
- `includeAppearances` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `includeImages` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `initialImageUrl` — routes: src/app/api/asset-hub/characters/route.ts
- `insertAfterPanelId` — routes: src/app/api/novel-promotion/[projectId]/insert-panel/route.ts, src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `insertIndex` — routes: src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts
- `invite_code` — routes: src/app/api/auth/register/route.ts
- `isActive` — routes: src/app/api/admin/users/[id]/active/route.ts
- `isBackgroundJob` — routes: src/app/api/asset-hub/reference-to-character/route.ts, src/app/api/novel-promotion/[projectId]/reference-to-character/route.ts
- `lineId` — routes: src/app/api/novel-promotion/[projectId]/voice-generate/route.ts, src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `linked` — routes: src/app/api/novel-promotion/[projectId]/panel-link/route.ts
- `lipSyncModel` — routes: src/app/api/novel-promotion/[projectId]/lip-sync/route.ts
- `locationImageId` — routes: src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts
- `locationOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `matchedPanelId` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `meta` — routes: src/app/api/asset-hub/modify-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `metadata` — routes: src/app/api/novel-promotion/[projectId]/location/route.ts
- `models` — routes: src/app/api/user/api-config/route.ts
- `modifyInstruction` — routes: src/app/api/novel-promotion/[projectId]/ai-modify-appearance/route.ts, src/app/api/novel-promotion/[projectId]/ai-modify-location/route.ts, src/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route.ts
- `modifyPrompt` — routes: src/app/api/asset-hub/modify-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts, src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `multiShotMode` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `newDescription` — routes: src/app/api/novel-promotion/[projectId]/update-appearance/route.ts, src/app/api/novel-promotion/[projectId]/update-location/route.ts
- `newName` — routes: src/app/api/asset-hub/update-asset-label/route.ts, src/app/api/novel-promotion/[projectId]/update-asset-label/route.ts
- `note` — routes: src/app/api/admin/invites/route.ts
- `organizationId` — routes: src/app/api/workspaces/route.ts
- `panelDurations` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelId` — routes: src/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route.ts, src/app/api/novel-promotion/[projectId]/analyze-shot-variants/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts...
- `panelIds` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelPreferences` — routes: src/app/api/novel-promotion/[projectId]/video-urls/route.ts
- `password` — routes: src/app/api/auth/register/route.ts
- `photographyPlan` — routes: src/app/api/novel-promotion/[projectId]/photography-plan/route.ts
- `preferredName` — routes: src/app/api/asset-hub/voice-design/route.ts, src/app/api/novel-promotion/[projectId]/voice-design/route.ts
- `previewText` — routes: src/app/api/asset-hub/voice-design/route.ts, src/app/api/novel-promotion/[projectId]/voice-design/route.ts
- `projectData` — routes: src/app/api/novel-promotion/[projectId]/editor/route.ts
- `prompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `promptStyle` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `propId` — routes: src/app/api/novel-promotion/[projectId]/prop/route.ts
- `providers` — routes: src/app/api/user/api-config/route.ts
- `rawPrompt` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `referenceImageUrl` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/reference-to-character/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts...
- `referenceImageUrls` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/reference-to-character/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts...
- `role` — routes: src/app/api/admin/invites/route.ts, src/app/api/admin/users/[id]/role/route.ts
- `scene` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `screenplay` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts
- `select` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `selectedAssets` — routes: src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `selectedImageUrl` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `shotId` — routes: src/app/api/novel-promotion/[projectId]/update-prompt/route.ts
- `sound` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `sourcePanelId` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `speaker` — routes: src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts, src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `srtContent` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts
- `srtSegment` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `storyboard` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `storyboardId` — routes: src/app/api/novel-promotion/[projectId]/generate-video/route.ts, src/app/api/novel-promotion/[projectId]/insert-panel/route.ts, src/app/api/novel-promotion/[projectId]/lip-sync/route.ts...
- `subtitle` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `targetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts
- `targets` — routes: src/app/api/task-target-states/route.ts
- `taskIds` — routes: src/app/api/tasks/dismiss/route.ts
- `text` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `userInstruction` — routes: src/app/api/asset-hub/ai-design-character/route.ts, src/app/api/asset-hub/ai-design-location/route.ts, src/app/api/novel-promotion/[projectId]/ai-create-character/route.ts...
- `userName` — routes: src/app/api/workspaces/[workspaceId]/members/route.ts
- `variant` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `viewName` — routes: src/app/api/novel-promotion/[projectId]/location/view/route.ts
- `voiceDesign` — routes: src/app/api/asset-hub/character-voice/route.ts, src/app/api/novel-promotion/[projectId]/character-voice/route.ts
- `voiceLineId` — routes: src/app/api/novel-promotion/[projectId]/lip-sync/route.ts
- `voicePresetId` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts

## DB columns never sourced from form or API

21 Prisma write keys whose name appears in no form field and no API body param.

Likely causes:
- Server-set field (timestamps, derived ids, computed slugs) — safe
- Worker-only field populated from upstream task result — safe
- Genuinely unused write that leaked from older code — minor cleanup target

- `addedBy` — writers: src/app/api/workspaces/[workspaceId]/members/route.ts
- `analysisModel` — writers: src/app/api/projects/route.ts
- `characterModel` — writers: src/app/api/projects/route.ts
- `code` — writers: src/lib/admin-service.ts
- `createdBy` — writers: src/lib/admin-service.ts
- `customVoiceMediaId` — writers: src/app/api/asset-hub/voices/route.ts
- `descriptions` — writers: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `editModel` — writers: src/app/api/projects/route.ts
- `endText` — writers: src/lib/workers/handlers/clips-build.ts, src/lib/workers/handlers/story-to-script-helpers.ts
- `episodeNumber` — writers: src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts, src/app/api/novel-promotion/[projectId]/episodes/route.ts
- `imageMediaId` — writers: src/app/api/asset-hub/characters/route.ts
- `imageUrl` — writers: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts
- `imageUrls` — writers: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `isSelected` — writers: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts
- `locationModel` — writers: src/app/api/projects/route.ts
- `novelPromotionProjectId` — writers: src/app/api/novel-promotion/[projectId]/character/route.ts, src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts, src/app/api/novel-promotion/[projectId]/episodes/route.ts...
- `previousImageUrls` — writers: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `startText` — writers: src/lib/workers/handlers/clips-build.ts, src/lib/workers/handlers/story-to-script-helpers.ts
- `storyboardModel` — writers: src/app/api/projects/route.ts
- `ttsRate` — writers: src/app/api/projects/route.ts
- `videoRatio` — writers: src/app/api/projects/route.ts

## Caveats

- Excludes V1 `[locale]/workspace/...` (tracked by v2-to-main migration plan)
- Excludes `node_modules`, `.next`, `dist`, `coverage`
- Pure regex; aliases (`const { X: y } = body`) and computed keys escape detection
- React `useState` / controlled input without `name` attribute not flagged as a form field
- `id`, `name`, `value`, `type`, `key`, `data` filtered as generic noise
