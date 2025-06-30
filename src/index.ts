import * as fs from 'node:fs'
import { invariant } from 'outvariant'
import type {
  TestFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  Page,
} from '@playwright/test'

export interface PersonaOptions {
  createSession: CreateSessionFunction
  ttl?: number
}

interface PlaywrightContext {
  page: unknown
}

export interface Persona {
  name: string
  createSession: CreateSessionFunction
  ttl?: number
}

type CreateSessionFunction = (
  context: PlaywrightContext,
) => Promise<DestroyFunction>

type DestroyFunction = () => Promise<void>

export function definePersona(name: string, options: PersonaOptions): Persona {
  return {
    name,
    ttl: options.ttl,
    async createSession(context) {
      const destroySession = await options.createSession(context)
      return destroySession
    },
  }
}

export type AuthenticateFunction = (
  options: AuthenticationOptions,
) => Promise<void>

export interface AuthenticationOptions {
  as: string
}

const STORAGE_STATE_DIRECTORY = new URL('./playwright/.auth/', import.meta.url)

export function combinePersonas(
  ...personas: Array<Persona>
): TestFixture<AuthenticateFunction, any> {
  return async (
    { context, page }: PlaywrightTestArgs & PlaywrightWorkerArgs,
    use,
  ) => {
    let destroySession: DestroyFunction | undefined

    await use(async (options) => {
      const persona = personas.find((persona) => {
        return persona.name === options.as
      })

      invariant(
        persona,
        'Failed to authenticate: cannot find persona by name "%s" (known personas: %s)',
        options.as,
        personas.join(', '),
      )

      const ttl = persona.ttl ?? Infinity
      const sessionFile = new URL(
        `./${persona.name}.json`,
        STORAGE_STATE_DIRECTORY,
      )

      if (
        !fs.existsSync(sessionFile) ||
        fs.statSync(sessionFile).ctimeMs >= Date.now() + ttl * 1000
      ) {
        destroySession = await persona.createSession({ page })
        await context.storageState({
          path: sessionFile.pathname,
        })
      } else {
        await restoreSessionState(sessionFile, page)
      }
    })

    await destroySession?.()
  }
}

async function restoreSessionState(filePath: URL, page: Page): Promise<void> {
  const contents = JSON.parse(
    await fs.promises.readFile(filePath, 'utf8'),
  ) as Awaited<ReturnType<PlaywrightTestArgs['context']['storageState']>>

  await page.context().addCookies(contents.cookies)

  /** @todo Apply local storage */
}
