import * as fs from 'node:fs'
import * as path from 'node:path'
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

export interface CreateSessionContext {
  page: Page
}

export interface Persona {
  name: string
  createSession: CreateSessionFunction
  ttl?: number
}

type CreateSessionFunction = (
  context: CreateSessionContext,
) => Promise<DestroyFunction | void>

type DestroyFunction = () => Promise<void> | void

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
  options: AuthenticateOptions,
) => Promise<void>

export interface AuthenticateOptions {
  as: string
}

const STORAGE_STATE_DIRECTORY = path.join(process.cwd(), './playwright/.auth/')

export function combinePersonas(
  ...personas: Array<Persona>
): TestFixture<AuthenticateFunction, any> {
  return async (
    { context, page }: PlaywrightTestArgs & PlaywrightWorkerArgs,
    use,
  ) => {
    let destroySession: DestroyFunction | undefined | void

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
      const sessionFile = path.join(
        STORAGE_STATE_DIRECTORY,
        `./${persona.name}.json`,
      )

      if (
        !fs.existsSync(sessionFile) ||
        fs.statSync(sessionFile).ctimeMs >= Date.now() + ttl * 1000
      ) {
        destroySession = await persona.createSession({ page })
        await context.storageState({
          path: sessionFile,
        })
      } else {
        await restoreSessionState(sessionFile, page)
      }
    })

    await destroySession?.()
  }
}

async function restoreSessionState(
  filePath: string,
  page: Page,
): Promise<void> {
  const contents = JSON.parse(
    await fs.promises.readFile(filePath, 'utf8'),
  ) as Awaited<ReturnType<PlaywrightTestArgs['context']['storageState']>>

  await page.context().addCookies(contents.cookies)

  if (contents.origins.length > 0) {
    const newPage = await page.context().newPage()
    await newPage.route(/.+/, async (route) => {
      await route.fulfill({ body: `<html></html>` }).catch(() => {})
    })

    await Promise.allSettled(
      contents.origins.map(async (state) => {
        const frame = newPage.mainFrame()
        await frame.goto(state.origin)

        for (const item of state.localStorage) {
          await frame.evaluate(
            ([key, value]) => {
              localStorage.setItem(key, value)
            },
            [item.name, item.value],
          )
        }
      }),
    )

    await newPage.close()
  }
}
