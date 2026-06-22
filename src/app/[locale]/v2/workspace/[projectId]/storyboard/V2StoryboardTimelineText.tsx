'use client'

/**
 * Phase 1 step 4 (2026-06-22) — Timeline text column (middle column).
 *
 * Extracted from V2StoryboardClient's Timeline branch (was inline at
 * lines 1721-1821). Description + dialogue textareas with save
 * buttons, plus the 景別 / 運鏡 chip groups that write directly
 * via useUpdateProjectPanel.
 *
 * Sibling of TimelineStrip / TimelineShot / TimelineInspector.
 */

import type { Dispatch, SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import { PromptChipGroup } from './PromptChipGroup'
import type { PanelLike } from './storyboard-client-helpers'
import type {
  UpdatePanelTextMutation,
} from './V2GroupsLayout'
import type { useUpdateProjectPanel } from '@/lib/query/mutations/storyboard-panel-mutations'

export interface V2StoryboardTimelineTextProps {
  selected: PanelLike | null
  selectedIndex: number
  descDraft: string
  setDescDraft: Dispatch<SetStateAction<string>>
  descChanged: boolean
  onSaveDescription: () => void
  dialogueDraft: string
  setDialogueDraft: Dispatch<SetStateAction<string>>
  dialogueChanged: boolean
  onSaveDialogue: () => void
  updatePanelText: UpdatePanelTextMutation
  updatePanel: ReturnType<typeof useUpdateProjectPanel>
  canEdit: boolean
}

export function V2StoryboardTimelineText(props: V2StoryboardTimelineTextProps) {
  const t = useTranslations('v2Storyboard')
  const {
    selected,
    selectedIndex,
    descDraft,
    setDescDraft,
    descChanged,
    onSaveDescription,
    dialogueDraft,
    setDialogueDraft,
    dialogueChanged,
    onSaveDialogue,
    updatePanelText,
    updatePanel,
    canEdit,
  } = props

  return (
    <div className="col-span-5 space-y-5 order-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[14px] tracking-wider text-amber-600">
            {t('timeline.shotDescTitle', { n: String(selectedIndex + 1).padStart(2, '0') })}
          </div>
          <button
            type="button"
            onClick={onSaveDescription}
            disabled={!descChanged || updatePanelText.isPending || !selected || !canEdit}
            className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {updatePanelText.isPending ? t('gallery.fields.savingButton') : t('gallery.fields.save')}
          </button>
        </div>
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          rows={5}
          placeholder={t('timeline.descPlaceholder')}
          className="w-full rounded-sm border border-amber-900/20 bg-stone-900/40 p-3 font-serif-cn text-sm leading-relaxed text-stone-300 outline-none focus:border-amber-500/40"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[14px] tracking-wider text-amber-600">
            {t('timeline.shotDialogueTitle', { n: String(selectedIndex + 1).padStart(2, '0') })}
          </div>
          <button
            type="button"
            onClick={onSaveDialogue}
            disabled={!dialogueChanged || updatePanelText.isPending || !selected || !canEdit}
            className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {updatePanelText.isPending ? t('gallery.fields.savingButton') : t('gallery.fields.save')}
          </button>
        </div>
        <textarea
          value={dialogueDraft}
          onChange={(e) => setDialogueDraft(e.target.value)}
          rows={3}
          placeholder={t('timeline.dialoguePlaceholder')}
          className="w-full rounded-sm border border-amber-900/20 bg-stone-900/40 p-3 font-serif-cn text-sm leading-relaxed text-stone-300 outline-none focus:border-amber-500/40"
        />
      </div>

      {/*
        Functional chip groups:
          - 景別  → panel.shotType   (DB column shotType)
          - 運鏡  → panel.cameraMove (DB column cameraMove)
        Click to set, click the active one again to clear. Saved
        immediately via useUpdateProjectPanel — no separate save
        button. The previous static `active={N}` props rendered
        decorative-only chips that did nothing on click and
        misled the user into thinking they were saving (reported
        2026-05-02).

        視角 / 質量詞 chip groups intentionally NOT rendered: there's
        no backing schema column for either field, so wiring them
        would require either a migration or appending tag prefixes
        to panel.description (which pollutes the user's text). Will
        ship in a follow-up commit when the schema gains
        viewAngle / qualityTags fields.
      */}
      <PromptChipGroup
        label={t('chips.shotSizeLabel')}
        options={[t('chips.shotSizes.wide'), t('chips.shotSizes.panorama'), t('chips.shotSizes.medium'), t('chips.shotSizes.near'), t('chips.shotSizes.closeup')]}
        cols={3}
        active={selected?.shotType ?? null}
        onChange={(value) => {
          if (!selected || selected.storyboardId == null || selected.panelIndex == null) return
          updatePanel.mutate({
            storyboardId: selected.storyboardId,
            panelIndex: selected.panelIndex,
            shotType: value,
          })
        }}
      />
      <PromptChipGroup
        label={t('chips.movementLabel')}
        options={[t('chips.movements.pushIn'), t('chips.movements.tiltDown'), t('chips.movements.handheld'), t('chips.movements.snapZoom'), t('chips.movements.upgrade')]}
        cols={1}
        active={selected?.cameraMove ?? null}
        onChange={(value) => {
          if (!selected || selected.storyboardId == null || selected.panelIndex == null) return
          updatePanel.mutate({
            storyboardId: selected.storyboardId,
            panelIndex: selected.panelIndex,
            cameraMove: value,
          })
        }}
      />
      {updatePanel.isPending ? (
        <div className="font-mono text-[12px] tracking-wider text-stone-500">{t('chips.saving')}</div>
      ) : updatePanel.isError ? (
        <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-2 py-1 font-mono text-[12px] tracking-wider text-rose-300">
          {t('chips.saveFailedWith', { reason: (updatePanel.error as Error)?.message ?? t('chips.saveFailedUnknown') })}
        </div>
      ) : null}
    </div>
  )
}
