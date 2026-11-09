'use server'

import { action } from '@/server/action'
import { saveArticle, saveArticleSchema } from '@/server/services/articles'

export const saveArticleAction = action(
  { auth: 'admin', input: saveArticleSchema },
  async ctx => saveArticle({ userId: ctx.userId! }, ctx.input),
)
