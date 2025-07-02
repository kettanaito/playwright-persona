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

type SessionValueType = string | number | Date | null | undefined

export type SessionType = Record<
  string,
  SessionValueType | { [key: string]: SessionValueType }
>

export interface PersonaOptions<Session extends SessionType> {
  createSession: CreateSessionFunction<Session>
  verifySession: VerifySessionFunction<Session>
  destroySession?: DestroySessionFunction<Session>
}

export interface CreateSessionContext {
  page: Page
}

export interface VerifySessionContext<Session extends SessionType> {
  session: Session
  page: Page
}

export interface DestroySessionContext<Session extends SessionType> {
  session: Session
  page: Page
}

export interface Persona<Name extends string, Session extends SessionType> {
  name: Name
  createSession: CreateSessionFunction<Session>
  verifySession: VerifySessionFunction<Session>
  destroySession?: DestroySessionFunction<Session>
}

export type CreateSessionFunction<Session extends SessionType> = (
  context: CreateSessionContext,
  testInfo: TestInfo,
) => Promise<Session>

export type VerifySessionFunction<Session extends SessionType> = (
  context: VerifySessionContext<Session>,
  testInfo: TestInfo,
) => Promise<void>

export type DestroySessionFunction<Session extends SessionType> = (
  context: DestroySessionContext<Session>,
  testInfo: TestInfo,
) => Promise<void>

export function definePersona<Name extends string, Session extends SessionType>(
  name: Name,
  options: PersonaOptions<Session>,
): Persona<Name, Session> {
  return {
    name,
    createSession: options.createSession,
    verifySession: options.verifySession,
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
    const createSessionFilePath = (persona: Persona<any, any>) => {
      return path.join(
        STORAGE_STATE_DIRECTORY,
        `./${testInfo.testId}-${persona.name}.json`,
      )
    }

    const createSession = async (persona: Persona<any, any>) => {
      const session = await persona.createSession({ page }, testInfo)
      const sessionFilePath = createSessionFilePath(persona)

      await context.storageState({
        path: sessionFilePath,
      })

      const sessionFile = await readSessionFile(sessionFilePath)
      sessionFile.session = session
      await fs.promises.writeFile(
        sessionFilePath,
        JSON.stringify(sessionFile, null, 2),
      )

      return session
    }

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

      const sessionFilePath = createSessionFilePath(persona)

      if (fs.existsSync(sessionFilePath)) {
        const sessionFile = await readSessionFile(sessionFilePath)

        return persona
          .verifySession(
            {
              page,
              session: sessionFile.session,
            },
            testInfo,
          )
          .then(async () => {
            await restoreSessionState(sessionFile, page)
            return sessionFile.session
          })
          .catch(async () => {
            await persona.destroySession?.(
              {
                page,
                session: sessionFile.session,
              },
              testInfo,
            )
            return createSession(persona)
          })
      }

      return createSession(persona)
    })
  }
}

type SessionFile = Awaited<
  ReturnType<PlaywrightTestArgs['context']['storageState']>
> & {
  session: Record<string, any>
}

async function readSessionFile(filePath: string): Promise<SessionFile> {
  const textContent = await fs.promises.readFile(filePath, 'utf8')
  return JSON.parse(textContent) as SessionFile
}

async function restoreSessionState(
  sesionFile: SessionFile,
  page: Page,
): Promise<void> {
  await page.context().addCookies(sesionFile.cookies)

  if (sesionFile.origins.length > 0) {
    const newPage = await page.context().newPage()
    await newPage.route(/.+/, async (route) => {
      await route.fulfill({ body: `<html></html>` }).catch(() => {})
    })

    await Promise.allSettled(
      sesionFile.origins.map(async (state) => {
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
