import type { z } from 'zod';
import type { managedMemberPage } from '../../../packages/types/src/settings.js';

type MemberPage = z.infer<typeof managedMemberPage>;

/** The member API returns ten rows. Combine at most five concurrent reads for
 * the shared page-size control without changing the IAM pagination contract. */
export async function loadMemberPage(
  offset: number,
  pageSize: number,
  read: (offset: number) => Promise<MemberPage>,
): Promise<MemberPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || ![10, 20, 30, 50].includes(pageSize))
    throw Error('Invalid member page');
  const offsets = Array.from({ length: pageSize / 10 }, (_, index) => offset + index * 10)
    .filter(value => value <= 100000);
  const pages = await Promise.all(offsets.map(read));
  return { members: pages.flatMap(page => page.members), nextOffset: pages.at(-1)?.nextOffset ?? null };
}
