import { test as playwrightTest, expect } from '@playwright/test'
import {
  combinePersonas,
  definePersona,
  type AuthenticateFunction,
} from '../src/index.js'

interface Fixtures {
  extraneousFixture: string
  authenticate: AuthenticateFunction<[typeof user]>
}

declare module '../src/index.js' {
  interface PersonaContext extends Fixtures {}
}

const user = definePersona('user', {
  async createSession() {
    return { name: extraneousFixture }
  },
  async verifySession() {
    console.log({ extraneousFixture })
  },
})

const test = playwrightTest.extend<Fixtures>({
  extraneousFixture: 'hello',
  async authenticate({ extraneousFixture }, use) {
    await use(combinePersonas(user))
  },
})

test('exposes existing Playwright fixtures onto the persona context', async ({
  authenticate,
}) => {
  const user = await authenticate({ as: 'user' })
  expect(user).toEqual({ name: 'hello' })
})
