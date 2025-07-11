import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { type Database } from '@/server/db'
import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  NonEmptyStringSchema,
  CountSchema,
  IdSchema,
} from '@/utils/server/base-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) =>
        /**
         * Question 4: Implement mutual friend count
         *
         * Add `mutualFriendCount` to the returned result of this query. You can
         * either:
         *  (1) Make a separate query to count the number of mutual friends,
         *  then combine the result with the result of this query
         *  (2) BONUS: Use a subquery (hint: take a look at how
         *  `totalFriendCount` is implemented)
         *
         * Instructions:
         *  - Go to src/server/tests/friendship-request.test.ts, enable the test
         * scenario for Question 3
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/SelectQueryBuilder.html#innerJoin
         */
        {
          const mutualsCte = conn.with('mutuals', (db) =>
            db
              .selectFrom('friendships as f1')
              .innerJoin(
                'friendships as f2',
                'f1.friendUserId',
                'f2.friendUserId'
              )
              .where('f1.userId', '=', ctx.session.userId)
              .where('f2.userId', '=', input.friendUserId)
              .where(
                'f1.status',
                '=',
                FriendshipStatusSchema.Values['accepted']
              )
              .where(
                'f2.status',
                '=',
                FriendshipStatusSchema.Values['accepted']
              )
              .select(['f1.friendUserId'])
          )

          const mainResult = await mutualsCte
            .selectFrom('users as friends')
            .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
            .innerJoin(
              userTotalFriendCount(conn).as('userTotalFriendCount'),
              'userTotalFriendCount.userId',
              'friends.id'
            )
            .where('friendships.userId', '=', ctx.session.userId)
            .where('friendships.friendUserId', '=', input.friendUserId)
            .where(
              'friendships.status',
              '=',
              FriendshipStatusSchema.Values['accepted']
            )
            .select([
              'friends.id',
              'friends.fullName',
              'friends.phoneNumber',
              'totalFriendCount',
            ])
            .groupBy([
              'friends.id',
              'friends.fullName',
              'friends.phoneNumber',
              'totalFriendCount',
            ])
            .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          const mutualCountRow = await mutualsCte
            .selectFrom('mutuals')
            .select((eb) => eb.fn.count('friendUserId').as('mutualFriendCount'))
            .executeTakeFirst()

          const mutualFriendList = await mutualsCte
            .selectFrom('mutuals')
            .innerJoin('users', 'users.id', 'mutuals.friendUserId')
            .select(['users.id', 'users.fullName', 'users.phoneNumber'])
            .execute()

          return z
            .object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
              mutualFriendCount: CountSchema,
              mutualFriendList: z.array(
                z.object({
                  id: IdSchema,
                  fullName: NonEmptyStringSchema,
                  phoneNumber: NonEmptyStringSchema,
                })
              ),
            })
            .parse({
              ...mainResult,
              mutualFriendCount: Number(mutualCountRow?.mutualFriendCount ?? 0),
              mutualFriendList,
            })
        }
      )
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
