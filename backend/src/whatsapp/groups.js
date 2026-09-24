'use strict';

/**
 * Group detection (task §13): live groups from the authenticated session.
 * Never hardcoded — always read from the connected account.
 */

const { getClient } = require('./client');

async function listGroups() {
  const client = getClient();
  const chats = await client.getChats();
  return chats
    .filter((c) => c.isGroup)
    .map((c) => ({
      chatId: c.id._serialized,
      name: c.name,
      participantCount: Array.isArray(c.participants) ? c.participants.length : null,
      lastActivityAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Resolve and validate a chatId for sending (task §31: group chats only). */
async function resolveGroupChat(chatId) {
  const client = getClient();
  const chat = await client.getChatById(chatId);
  if (!chat || !chat.isGroup) {
    const err = new Error(`Chat ${chatId} is not a group. Only group sends are allowed.`);
    err.code = 'NOT_A_GROUP';
    throw err;
  }
  return chat;
}

module.exports = { listGroups, resolveGroupChat };
