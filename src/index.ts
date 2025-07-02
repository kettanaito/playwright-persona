import * as fs from 'node:fs'
import * as path from 'node:path'
import { invariant } from 'outvariant'
import type {
  TestFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  Page,
  TestInfo,
} from '@playwright/test'

export interface PersonaOptions<Session extends Record<string, unknown>> {
  createSession: CreateSessionFunction<Session>
  ttl?: number
}

export interface CreateSessionContext {
  page: Page
}

export interface Persona<
  Name extends string,
  Session extends Record<string, unknown>,
> {
  name: Name
  createSession: CreateSessionFunction<Session>
  ttl?: number
}

export type CreateSessionFunction<Session extends Record<string, unknown>> = (
  context: CreateSessionContext,
  testInfo: TestInfo,
) => Promise<Session>

export function definePersona<
  Name extends string,
  Session extends Record<string, unknown>,
>(name: Name, options: PersonaOptions<Session>): Persona<Name, Session> {
  return {
    name,
    ttl: options.ttl,
    async createSession(context, testInfo) {
      return await options.createSession(context, testInfo)
    },
  }
}

export type AuthenticateFunction<Personas extends Array<Persona<any, any>>> =
  (options: {
    as: ExtractPersonaNames<Personas>
  }) => Promise<ExtractSessionTypes<Personas>[(typeof options)['as']]>

type ExtractPersonaNames<Personas extends Array<Persona<any, any>>> =
  Personas extends Array<infer P>
    ? P extends Persona<infer Name, any>
      ? Name
      : never
    : never

type ExtractSessionTypes<Personas extends Array<Persona<any, any>>> =
  Personas extends Array<infer P>
    ? P extends Persona<infer Name, infer Session>
      ? Record<Name, Session>
      : never
    : never

const STORAGE_STATE_DIRECTORY = path.join(process.cwd(), './playwright/.auth/')

export function combinePersonas<Personas extends Array<Persona<any, any>>>(
  ...personas: Personas
): TestFixture<AuthenticateFunction<Personas>, any> {
  return async (
    { context, page }: PlaywrightTestArgs & PlaywrightWorkerArgs,
    use,
    testInfo,
  ) => {
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
        `./${testInfo.testId}-${persona.name}.json`,
      )

      if (
        !fs.existsSync(sessionFile) ||
        fs.statSync(sessionFile).ctimeMs >= Date.now() + ttl * 1000
      ) {
        const session = await persona.createSession({ page }, testInfo)
        await context.storageState({
          path: sessionFile,
        })

        return session
      } else {
        await restoreSessionState(sessionFile, page)
      }
    })
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
