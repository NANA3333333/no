# Engine Tail Mechanism Backup (2026-03-26)

This file preserves the previous raw-tail injection logic before removing it from the live Claude/private reply prompt path.

## Previous Context Priority Rules

```js
block += '\n\n[Context Priority Rules]\n- The user\'s newest explicit wording is the highest-priority source of truth.\n- The newest raw tail messages are the next-highest source of truth.\n- Compressed digest and anti-repeat blocks are only helper summaries.\n- If any older context conflicts with the user\'s newest explicit wording, trust the user\'s newest wording.\n- If any compressed block conflicts with the latest raw tail messages, trust the latest raw tail messages.\n- When the user is correcting your interpretation, first repair the misunderstanding instead of defending an older interpretation.';
```

## Previous Raw Tail Injection

```js
const transformedHistory = buildSlidingHistoryWindow(db, character.id, liveHistoryWindowSize, liveHistory);

const { prompt: systemPrompt, retrievedMemoriesContext } = await buildPrompt(charCheck, liveHistory, isTimerWakeup, {
    conversationDigest,
    antiRepeatMessages: contextHistory
});
const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...transformedHistory
];
```

## Previous Memory Extraction Source

```js
memory.extractMemoryFromContext(character, [...transformedHistory, { role: 'character', content: generatedText }])
    .catch(err => console.error('[Engine] Memory extraction err:', err.message));
```
