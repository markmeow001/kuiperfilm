# Field-wire audit v3 — 2026-05-03

v2 + (a) `mutationFn: async (p: {X,Y}) => ...; body: JSON.stringify(p)` payload-type extraction, (b) `(body as ...).X` cast-pattern reads.

## Counts

| Metric | v2 | v3 | Δ |
| --- | ---: | ---: | ---: |
| frontend_keys_sent | 54 | 105 | +51 |
| api_keys_read | 155 | 156 | +1 |
| matched | 45 | 83 | +38 |
| sent_not_read | 9 | 22 | +13 |
| read_not_sent | 110 | 73 | -37 |

## SENT_NOT_READ — frontend sends but no API route reads

22 keys.

- `async` — sent from: src/lib/query/mutations/useEpisodeMutations.ts, src/lib/query/mutations/useProjectConfigMutations.ts
- `audioBase64` — sent from: src/lib/query/mutations/character-voice-mutations.ts
- `audio_url` — sent from: src/lib/kling.ts
- `characterName` — sent from: src/app/api/asset-hub/characters/route.ts, src/app/api/novel-promotion/[projectId]/character/route.ts
- `currentVideoPrompt` — sent from: src/lib/query/mutations/storyboard-prompt-mutations.ts
- `customPrompt` — sent from: src/lib/query/hooks/useStoryboards.ts
- `file` — sent from: src/lib/query/mutations/asset-hub-character-mutations.ts, src/lib/query/mutations/character-base-mutations.ts...
- `flModel` — sent from: src/lib/query/hooks/useStoryboards.ts
- `generateImage` — sent from: src/lib/query/mutations/character-profile-mutations.ts
- `labelText` — sent from: src/lib/query/mutations/asset-hub-character-mutations.ts, src/lib/query/mutations/character-base-mutations.ts...
- `lastFramePanelIndex` — sent from: src/lib/query/hooks/useStoryboards.ts
- `lastFrameStoryboardId` — sent from: src/lib/query/hooks/useStoryboards.ts
- `locale` — sent from: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/locations/route.ts...
- `model` — sent from: src/lib/ark-llm.ts
- `quality` — sent from: src/features/video-editor/hooks/useEditorActions.ts
- `referencedAssets` — sent from: src/lib/query/mutations/storyboard-prompt-mutations.ts
- `triggerGlobalAnalysis` — sent from: src/lib/query/mutations/useEpisodeMutations.ts
- `uploadFile` — sent from: src/lib/query/mutations/asset-hub-voice-mutations.ts
- `userInput` — sent from: src/lib/query/mutations/storyboard-panel-mutations.ts
- `video_url` — sent from: src/lib/kling.ts
- `voiceBase64` — sent from: src/lib/query/mutations/asset-hub-voice-mutations.ts
- `voiceName` — sent from: src/lib/query/mutations/asset-hub-voice-mutations.ts

## READ_NOT_SENT — API reads but no frontend send caught

73 keys.

- `aliases` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `aspectRatio` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `audioModel` — routes: src/app/api/novel-promotion/[projectId]/voice-generate/route.ts
- `cameraMove` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `capabilityOverrides` — routes: src/app/api/novel-promotion/[projectId]/route.ts
- `characterOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `characters` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts
- `composition` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `count` — routes: src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts
- `descriptionIndex` — routes: src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts, src/app/api/novel-promotion/[projectId]/character/appearance/route.ts...
- `dialogue` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `displayName` — routes: src/app/api/auth/register/route.ts
- `duration` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `editor` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `email` — routes: src/app/api/auth/register/route.ts
- `emotionPrompt` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `emotionStrength` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `expires_hours` — routes: src/app/api/admin/invites/route.ts
- `firstLastFramePrompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `globalAssetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts
- `globalCharacterId` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `globalLocationId` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `globalVoiceId` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `includeAppearances` — routes: src/app/api/projects/[projectId]/import-character/route.ts
- `includeImages` — routes: src/app/api/projects/[projectId]/import-location/route.ts
- `intent` — routes: src/app/api/sse/route.ts
- `introduction` — routes: src/app/api/novel-promotion/[projectId]/character/route.ts
- `lipSyncModel` — routes: src/app/api/novel-promotion/[projectId]/lip-sync/route.ts
- `location` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts, src/app/api/novel-promotion/[projectId]/panel/route.ts
- `locationImageId` — routes: src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts
- `locationOverrides` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `multiShotMode` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `newDescription` — routes: src/app/api/novel-promotion/[projectId]/update-appearance/route.ts, src/app/api/novel-promotion/[projectId]/update-location/route.ts
- `order` — routes: src/app/api/novel-promotion/[projectId]/episodes/reorder/route.ts
- `ownerEditorId` — routes: src/app/api/workspaces/[workspaceId]/route.ts, src/app/api/workspaces/route.ts
- `ownerUserId` — routes: src/app/api/organizations/[organizationId]/route.ts
- `panelDurations` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelIds` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `panelNumber` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `password` — routes: src/app/api/auth/register/route.ts
- `photographyRules` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `profileConfirmed` — routes: src/app/api/asset-hub/characters/[characterId]/route.ts
- `prompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `promptStyle` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `rawPrompt` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `referenceImageUrl` — routes: src/app/api/asset-hub/characters/route.ts, src/app/api/asset-hub/reference-to-character/route.ts...
- `scene` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `screenplay` — routes: src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts
- `select` — routes: src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts
- `selectedAssets` — routes: src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts
- `shotId` — routes: src/app/api/novel-promotion/[projectId]/update-prompt/route.ts
- `shotType` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `sound` — routes: src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
- `sourcePanelId` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `srtContent` — routes: src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts
- `srtEnd` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `srtStart` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `storyboard` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `subtitle` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts
- `targetId` — routes: src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts, src/app/api/runs/route.ts...
- `targetType` — routes: src/app/api/runs/route.ts, src/app/api/task-target-states/route.ts
- `targets` — routes: src/app/api/task-target-states/route.ts
- `taskId` — routes: src/app/api/runs/route.ts
- `taskIds` — routes: src/app/api/tasks/dismiss/route.ts
- `taskType` — routes: src/app/api/runs/route.ts
- `types` — routes: src/app/api/task-target-states/route.ts
- `ui` — routes: src/app/api/sse/route.ts
- `userId` — routes: src/app/api/workspaces/[workspaceId]/members/route.ts
- `variant` — routes: src/app/api/novel-promotion/[projectId]/panel-variant/route.ts
- `videoPrompt` — routes: src/app/api/novel-promotion/[projectId]/panel/route.ts, src/app/api/novel-promotion/[projectId]/safe-rewrite/route.ts
- `voiceDesign` — routes: src/app/api/asset-hub/character-voice/route.ts, src/app/api/novel-promotion/[projectId]/character-voice/route.ts
- `voicePresetId` — routes: src/app/api/novel-promotion/[projectId]/voice-lines/route.ts
- `workflowType` — routes: src/app/api/runs/route.ts
