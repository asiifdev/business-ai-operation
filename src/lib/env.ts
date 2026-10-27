/** Reads a server-side variable under both Astro (import.meta.env) and plain Node scripts (process.env). */
export function env(name: string): string | undefined {
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return fromVite ?? process.env[name];
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
