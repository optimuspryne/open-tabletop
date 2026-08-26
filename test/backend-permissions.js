import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANK, rankOf, canManageMember, canSetMemberRole } from '../server/permissions.js';

test('unknown and missing roles receive player rank', () => {
  assert.equal(rankOf(), RANK.player);
  assert.equal(rankOf('invented'), RANK.player);
});

test('member management follows the owner/GM hierarchy', () => {
  assert.equal(canManageMember(RANK.gm, 'player'), true);
  assert.equal(canManageMember(RANK.gm, 'helper'), true);
  assert.equal(canManageMember(RANK.gm, 'gm'), false);
  assert.equal(canManageMember(RANK.owner, 'gm'), true);
  assert.equal(canManageMember(RANK.owner, 'owner'), false);
  assert.equal(canManageMember(RANK.helper, 'player'), false);
});

test('only owners can promote or demote GMs and ownership cannot be assigned', () => {
  assert.equal(canSetMemberRole(RANK.gm, 'player', 'helper'), true);
  assert.equal(canSetMemberRole(RANK.gm, 'helper', 'gm'), false);
  assert.equal(canSetMemberRole(RANK.owner, 'helper', 'gm'), true);
  assert.equal(canSetMemberRole(RANK.owner, 'gm', 'helper'), true);
  assert.equal(canSetMemberRole(RANK.owner, 'player', 'owner'), false);
  assert.equal(canSetMemberRole(RANK.owner, 'owner', 'player'), false);
});
