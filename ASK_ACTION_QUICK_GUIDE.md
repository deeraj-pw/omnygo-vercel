# 'Ask' Action - Quick Reference

## What Is It?

Human-in-the-loop feature that pauses automation to ask the user for input.

## When Does It Trigger?

Claude decides to use 'ask' action when:
- Login page encountered
- Password field needed
- User-specific information required
- Sensitive credentials needed

## What Happens?

1. **Claude analyzes screenshot**
2. **Claude decides**: "I need to ask the user"
3. **Claude sends ask action**: `{ "action": "ask", "question": "What credentials?" }`
4. **Frontend shows prompt**: User sees `prompt()` dialog
5. **User enters answer**: Clicks OK
6. **Loop continues**: Answer added to history
7. **Claude proceeds**: Now knows the answer

## System Prompt Rules

Added to Claude's instructions:

```
- If you encounter a login page, password field, or need 
  information only the user has, use the "ask" action 
  instead of guessing.
- NEVER enter passwords or personal credentials on your own.
```

## Code Changes

### Backend (api/run-task.js)

**In system prompt**:
```javascript
{ "action": "ask", "question": "What credentials should I use?" }
```

**After parsing action**:
```javascript
if (agentAction.action === 'ask') {
  res.status(200).json({ 
    agentAction, 
    done: false,
    needsInput: true,
    question: agentAction.question,
    assistantMessage: response.content[0].text
  });
  return;
}
```

### Frontend (public/index.html)

**Prompt function**:
```javascript
function promptUserForInput(question) {
  return new Promise((resolve) => {
    const answer = prompt(question || 'The agent needs your input:');
    resolve(answer || 'No answer provided');
  });
}
```

**In loop**:
```javascript
if (stepData.needsInput) {
  addActivityStepAPI('Need your input', stepData.question);
  const userAnswer = await promptUserForInput(stepData.question);
  conversationHistory.push({ 
    role: 'user', 
    content: 'User provided: ' + userAnswer 
  });
  continue;
}
```

## Example Interaction

```
Goal: "Login to demo.opencart.com"

[Step 1: Navigate] ✓
[Step 2: Claude sees login form]

Prompt appears:
┌─────────────────────────────┐
│ What are the login          │
│ credentials?                │
│                             │
│ [admin / password123]  [OK] │
└─────────────────────────────┘

User enters answer, clicks OK

[Step 3: Type username] ✓
[Step 4: Type password] ✓
[Step 5: Click login] ✓

Result: ✅ Logged in
```

## Key Features

✅ Simple browser prompt()
✅ Async/await support
✅ Answer in conversation history
✅ Loop continues seamlessly
✅ Security-focused (asks instead of guessing)
✅ Backward compatible

## Conversation History Effect

When user provides answer:

```javascript
conversationHistory.push({ 
  role: 'user', 
  content: 'User provided: admin / password123' 
});
```

Claude can then:
- Reference the answer in next steps
- Use multiple times if needed
- Maintain full context
- Remember throughout task

## Testing Checklist

✅ Goal with login form
✅ AI asks for credentials
✅ Prompt appears
✅ User provides answer
✅ Loop continues
✅ Credentials used successfully
✅ Task completes

## Status: READY FOR PRODUCTION ✅
