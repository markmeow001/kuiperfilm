import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert'])
const AUDIO_FIELDS = new Set(['audioUrl', 'audioMediaId'])
const PUBLICATION_FILE = 'src/lib/voice/voice-line-publication.ts'
const VOICE_LINES_ROUTE = 'src/app/api/novel-promotion/[projectId]/voice-lines/route.ts'
const PROJECT_CHARACTER_VOICE_ROUTE =
  'src/app/api/novel-promotion/[projectId]/character-voice/route.ts'
const VOICE_PRESET_ROUTE =
  'src/app/api/novel-promotion/[projectId]/voice-presets/route.ts'
const USER_MEDIA_WRITE_ROUTES = [
  {
    file: 'src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts',
    field: 'audioUrl',
  },
  { file: 'src/app/api/asset-hub/characters/route.ts', field: 'initialImageUrl' },
] as const

type AudioWrite = {
  file: string
  method: string
  field: string
  value: string
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [relative('.', path)] : []
  })
}

function nameOf(node: ts.PropertyName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null
}

function propertyOf(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && nameOf(property.name) === name) return property
  }
  return null
}

function voiceLineWriteMethod(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null
  const method = node.expression.name.text
  if (!WRITE_METHODS.has(method)) return null
  const model = node.expression.expression
  return ts.isPropertyAccessExpression(model) && model.name.text === 'novelPromotionVoiceLine'
    ? method
    : null
}

function collectAudioWrites(file: string): AudioWrite[] {
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const writes: AudioWrite[] = []
  const identifierMethods = new Map<string, Set<string>>()

  const recordObject = (method: string, object: ts.ObjectLiteralExpression) => {
    for (const field of AUDIO_FIELDS) {
      const property = propertyOf(object, field)
      if (!property || property.initializer.kind === ts.SyntaxKind.NullKeyword) continue
      writes.push({ file, method, field, value: property.initializer.getText(sourceFile) })
    }
  }

  const visitCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = voiceLineWriteMethod(node)
      const argument = node.arguments[0]
      if (method && argument && ts.isObjectLiteralExpression(argument)) {
        const data = propertyOf(argument, 'data')
        if (data && ts.isObjectLiteralExpression(data.initializer)) {
          recordObject(method, data.initializer)
        } else if (data && ts.isIdentifier(data.initializer)) {
          const methods = identifierMethods.get(data.initializer.text) || new Set<string>()
          methods.add(method)
          identifierMethods.set(data.initializer.text, methods)
        }
      }
    }
    ts.forEachChild(node, visitCalls)
  }
  visitCalls(sourceFile)

  const visitBoundData = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && ts.isIdentifier(node.left.expression)
      && AUDIO_FIELDS.has(node.left.name.text)
      && node.right.kind !== ts.SyntaxKind.NullKeyword
    ) {
      const methods = identifierMethods.get(node.left.expression.text)
      for (const method of methods || []) {
        writes.push({
          file,
          method,
          field: node.left.name.text,
          value: node.right.getText(sourceFile),
        })
      }
    }
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const method of identifierMethods.get(node.name.text) || []) {
        recordObject(method, node.initializer)
      }
    }
    ts.forEachChild(node, visitBoundData)
  }
  visitBoundData(sourceFile)
  return writes
}

describe('NovelPromotionVoiceLine audio write invariant', () => {
  it('[all src model writers] -> [only atomic publication writes a non-null audio pointer]', () => {
    const writes = listSourceFiles('src').flatMap(collectAudioWrites)

    expect(writes).toEqual([
      {
        file: PUBLICATION_FILE,
        method: 'updateMany',
        field: 'audioUrl',
        value: 'marker.outputUrl',
      },
    ])
  })

  it('[voice-lines PATCH source] -> [audio assignments are null-only and legacy resolver is absent]', () => {
    const source = readFileSync(VOICE_LINES_ROUTE, 'utf8')
    const sourceFile = ts.createSourceFile(VOICE_LINES_ROUTE, source, ts.ScriptTarget.Latest, true)
    const assignments: Array<{ field: string; value: string }> = []
    const forbiddenImports: string[] = []

    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node)
        && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === '@/lib/media/service'
        && node.importClause?.namedBindings
        && ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if (element.name.text === 'resolveMediaRefFromLegacyValue') {
            forbiddenImports.push(element.name.text)
          }
        }
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left)
        && ts.isIdentifier(node.left.expression)
        && node.left.expression.text === 'updateData'
        && AUDIO_FIELDS.has(node.left.name.text)
      ) {
        assignments.push({
          field: node.left.name.text,
          value: node.right.getText(sourceFile),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)

    expect(forbiddenImports).toEqual([])
    expect(assignments.every(({ value }) => value === 'null')).toBe(true)
  })

  it('[all request-derived audio writers] -> [exact route inventory uses the shared reserved-key policy]', () => {
    const writes = new Set<string>()

    for (const file of listSourceFiles('src/app/api').filter((path) => path.endsWith('/route.ts'))) {
      const source = readFileSync(file, 'utf8')
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const bodyFields = new Set<string>()

      const collectBodyFields = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node)
          && ts.isObjectBindingPattern(node.name)
          && node.initializer
          && ts.isIdentifier(node.initializer)
          && node.initializer.text === 'body'
        ) {
          for (const element of node.name.elements) {
            const field = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name) ? element.name.text : null
            if (
              field === 'audioUrl'
              || field === 'customVoiceUrl'
              || field === 'initialImageUrl'
            ) bodyFields.add(field)
          }
        }
        ts.forEachChild(node, collectBodyFields)
      }
      collectBodyFields(sourceFile)

      const containsIdentifier = (node: ts.Node, identifier: string): boolean => {
        if (ts.isIdentifier(node) && node.text === identifier) {
          if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return false
          if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false
          return true
        }
        return node.getChildren(sourceFile).some((child) => containsIdentifier(child, identifier))
      }
      const collectWrites = (node: ts.Node) => {
        if (
          ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(node.left)
        ) {
          for (const bodyField of bodyFields) {
            if (containsIdentifier(node.right, bodyField)) {
              writes.add(`${file}:${bodyField}`)
            }
          }
        }
        if (ts.isPropertyAssignment(node)) {
          for (const bodyField of bodyFields) {
            if (containsIdentifier(node.initializer, bodyField)) {
              writes.add(`${file}:${bodyField}`)
            }
          }
        }
        ts.forEachChild(node, collectWrites)
      }
      collectWrites(sourceFile)
    }

    expect([...writes].sort()).toEqual(
      USER_MEDIA_WRITE_ROUTES.map(({ file, field }) => `${file}:${field}`).sort(),
    )

    for (const { file, field } of USER_MEDIA_WRITE_ROUTES) {
      const source = readFileSync(file, 'utf8')
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      let importsPolicy = false
      let guardsField = false
      const visit = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node)
          && ts.isStringLiteral(node.moduleSpecifier)
          && node.moduleSpecifier.text === '@/lib/media/write-policy'
        ) {
          importsPolicy = true
        }
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === 'assertUserMediaWriteReferenceAllowed'
          && node.arguments.some((argument) => argument.getText(sourceFile).includes(field))
        ) {
          guardsField = true
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
      expect({ file, importsPolicy, guardsField }).toEqual({
        file,
        importsPolicy: true,
        guardsField: true,
      })
    }

    const projectCharacterSource = readFileSync(PROJECT_CHARACTER_VOICE_ROUTE, 'utf8')
    expect(projectCharacterSource).toContain("voiceWrite.kind !== 'clear'")
    expect(projectCharacterSource).toContain('customVoiceUrl: null')

    const presetSource = readFileSync(VOICE_PRESET_ROUTE, 'utf8')
    const presetFile = ts.createSourceFile(
      VOICE_PRESET_ROUTE,
      presetSource,
      ts.ScriptTarget.Latest,
      true,
    )
    const exportedMethods: string[] = []
    for (const statement of presetFile.statements) {
      if (
        ts.isVariableStatement(statement)
        && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exportedMethods.push(declaration.name.text)
        }
      }
    }
    expect(exportedMethods).toEqual(['GET'])
  })
})
