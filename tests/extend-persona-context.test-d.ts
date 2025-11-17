import { it, expectTypeOf } from 'vitest'
import { definePersona, type AuthenticateFunction } from '../src/index.js'
import type { Page } from '@playwright/test'

interface Fixtures {
  extraneousFixture: string
  authenticate: AuthenticateFunction<[]>
}

declare module '../src/index.js' {
  interface PersonaContext extends Fixtures {}
}

it('extends the default PersonaContext with custom Playwright fixtures', () => {
  definePersona('user', {
    createSession: async (context) => {
      expectTypeOf(context).toEqualTypeOf<{
        page: Page
        extraneousFixture: string
        authenticate: AuthenticateFunction<any>
      }>()
      return { a: 'hello' }
    },
    verifySession: async (context) => {
      expectTypeOf(context).toEqualTypeOf<{
        page: Page
        session: { a: string }
        extraneousFixture: string
        authenticate: AuthenticateFunction<any>
      }>()
    },
    destroySession: async (context) => {
      expectTypeOf(context).toEqualTypeOf<{
        page: Page
        session: { a: string }
        extraneousFixture: string
        authenticate: AuthenticateFunction<any>
      }>()
    },
  })
})
