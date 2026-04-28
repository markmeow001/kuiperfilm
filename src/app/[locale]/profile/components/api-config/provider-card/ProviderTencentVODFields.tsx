'use client'

import { useState, useMemo } from 'react'
import type { ProviderCardProps, ProviderCardTranslator } from './types'
import { AppIcon } from '@/components/ui/icons'

interface ProviderTencentVODFieldsProps {
    provider: ProviderCardProps['provider']
    t: ProviderCardTranslator
    onUpdateApiKey: ProviderCardProps['onUpdateApiKey']
}

interface TencentVODCreds {
    secretId: string
    secretKey: string
    subAppId: string
    region: string
}

const REGIONS = [
    { value: 'ap-guangzhou', label: '廣州 (ap-guangzhou)' },
    { value: 'ap-beijing', label: '北京 (ap-beijing)' },
    { value: 'ap-shanghai', label: '上海 (ap-shanghai)' },
    { value: 'ap-hongkong', label: '香港 (ap-hongkong)' },
    { value: 'ap-singapore', label: '新加坡 (ap-singapore)' },
]

function parseExistingCreds(apiKey?: string): TencentVODCreds {
    const empty: TencentVODCreds = { secretId: '', secretKey: '', subAppId: '', region: 'ap-guangzhou' }
    if (!apiKey) return empty
    try {
        const parsed = JSON.parse(apiKey) as Record<string, unknown>
        return {
            secretId: typeof parsed.secretId === 'string' ? parsed.secretId : '',
            secretKey: typeof parsed.secretKey === 'string' ? parsed.secretKey : '',
            subAppId: parsed.subAppId !== undefined ? String(parsed.subAppId) : '',
            region: typeof parsed.region === 'string' && parsed.region ? parsed.region : 'ap-guangzhou',
        }
    } catch {
        return empty
    }
}

export function ProviderTencentVODFields({ provider, t, onUpdateApiKey }: ProviderTencentVODFieldsProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [showSecretKey, setShowSecretKey] = useState(false)

    const initial = useMemo(() => parseExistingCreds(provider.apiKey), [provider.apiKey])
    const [form, setForm] = useState<TencentVODCreds>(initial)

    const handleStart = () => {
        setForm(parseExistingCreds(provider.apiKey))
        setIsEditing(true)
    }

    const handleCancel = () => {
        setForm(parseExistingCreds(provider.apiKey))
        setIsEditing(false)
    }

    const handleSave = () => {
        const subAppIdNum = Number(form.subAppId)
        if (!form.secretId.trim()) {
            alert('請輸入 SecretId')
            return
        }
        if (!form.secretKey.trim()) {
            alert('請輸入 SecretKey')
            return
        }
        if (!Number.isFinite(subAppIdNum) || subAppIdNum <= 0) {
            alert('SubAppId 必須是正整數（11 位數字，例如 1500044236）')
            return
        }
        const payload = JSON.stringify({
            secretId: form.secretId.trim(),
            secretKey: form.secretKey.trim(),
            subAppId: subAppIdNum,
            region: form.region || 'ap-guangzhou',
        })
        onUpdateApiKey(provider.id, payload)
        setIsEditing(false)
    }

    const summary = useMemo(() => {
        const c = parseExistingCreds(provider.apiKey)
        if (!c.secretId) return null
        const masked = c.secretId.length > 8
            ? c.secretId.slice(0, 4) + '••••' + c.secretId.slice(-4)
            : '••••'
        return { secretId: masked, subAppId: c.subAppId, region: c.region }
    }, [provider.apiKey])

    return (
        <div className="px-3.5 pt-2.5">
            <div className="glass-surface-soft rounded-xl px-3 py-3 space-y-2">
                {!isEditing && summary && (
                    <div className="space-y-1.5 text-[12px] text-[var(--glass-text-secondary)]">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="font-semibold text-[var(--glass-text-primary)]">SecretId</span>
                                <span className="ml-2 font-mono">{summary.secretId}</span>
                            </div>
                            <button
                                onClick={handleStart}
                                className="glass-icon-btn-sm"
                                title={t('configure')}
                            >
                                <AppIcon name="edit" className="h-4 w-4" />
                            </button>
                        </div>
                        <div>
                            <span className="font-semibold text-[var(--glass-text-primary)]">SubAppId</span>
                            <span className="ml-2 font-mono">{summary.subAppId}</span>
                        </div>
                        <div>
                            <span className="font-semibold text-[var(--glass-text-primary)]">Region</span>
                            <span className="ml-2 font-mono">{summary.region}</span>
                        </div>
                    </div>
                )}

                {!isEditing && !summary && (
                    <button
                        onClick={handleStart}
                        className="glass-btn-base glass-btn-tone-info h-7 px-2.5 text-[12px] font-semibold"
                    >
                        <AppIcon name="plus" className="h-3.5 w-3.5" />
                        <span>{t('connect')} (Tencent VOD)</span>
                    </button>
                )}

                {isEditing && (
                    <div className="space-y-2">
                        <Field label="SecretId">
                            <input
                                type="text"
                                value={form.secretId}
                                onChange={(e) => setForm({ ...form, secretId: e.target.value })}
                                placeholder="AKIDxxxxxxxxxxxxxxxxxxxxxxxx"
                                className="glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono"
                                autoFocus
                            />
                        </Field>

                        <Field label="SecretKey">
                            <input
                                type={showSecretKey ? 'text' : 'password'}
                                value={form.secretKey}
                                onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                className="glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setShowSecretKey(!showSecretKey)}
                                className="glass-icon-btn-sm shrink-0"
                                title={showSecretKey ? t('hide') : t('show')}
                            >
                                <AppIcon name={showSecretKey ? 'eye' : 'eyeOff'} className="h-4 w-4" />
                            </button>
                        </Field>

                        <Field label="SubAppId">
                            <input
                                type="text"
                                value={form.subAppId}
                                onChange={(e) => setForm({ ...form, subAppId: e.target.value })}
                                placeholder="1500044236（11 位數字）"
                                className="glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono"
                            />
                        </Field>

                        <Field label="Region">
                            <select
                                value={form.region}
                                onChange={(e) => setForm({ ...form, region: e.target.value })}
                                className="glass-input-base flex-1 px-3 py-1.5 text-[12px]"
                            >
                                {REGIONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <div className="text-[11px] text-[var(--glass-text-tertiary)] pt-1">
                            憑證從{' '}
                            <a
                                href="https://console.cloud.tencent.com/cam/capi"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                CAM 控制台
                            </a>
                            {' '}取得，SubAppId 從{' '}
                            <a
                                href="https://console.cloud.tencent.com/vod/app-manage"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                雲點播應用管理
                            </a>
                            {' '}取得。需要先聯繫騰訊客服開通 AIGC 白名單。
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                                onClick={handleCancel}
                                className="glass-icon-btn-sm"
                                title={t('cancel')}
                            >
                                <AppIcon name="close" className="h-4 w-4" />
                            </button>
                            <button
                                onClick={handleSave}
                                className="glass-icon-btn-sm"
                                title={t('save')}
                            >
                                <AppIcon name="check" className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2.5">
            <span className="w-[80px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-primary)]">
                {label}
            </span>
            {children}
        </div>
    )
}
