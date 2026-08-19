export function shouldHideInternalPrototypeRoutes(
  environment: string | undefined = process.env.NODE_ENV,
): boolean {
  return environment === 'production'
}
