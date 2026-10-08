// Anthropic provider shared by every AI domain (IoT, sourcing). Single read-only call: no tools, structured JSON output.

const Anthropic = require('@anthropic-ai/sdk');

// Exactly the configured model, one request, no SDK retry, no fallback model, no tools.
const MAX_OUTPUT_TOKENS = 2500;

function createAnthropicProvider(config, client) {
    if (!client && !hasAnthropicCredential()) throw new Error('AI_CREDENTIAL_MISSING');
    client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000, maxRetries: 0 });

    async function complete({ system, user, schema }) {
        const response = await client.messages.create({
            model: config.model || 'claude-opus-5-5',
            max_tokens: MAX_OUTPUT_TOKENS,
            output_config: { effort: config.effort || 'medium', format: { type: 'json_schema', schema } },
            system,
            messages: [{ role: 'user', content: user }],
        });
        if (response.stop_reason === 'refusal') throw new Error('AI_REFUSED');
        if (response.stop_reason === 'max_tokens') throw new Error('AI_TRUNCATED');
        const text = response.content.find(b => b.type === 'text');
        if (!text) throw new Error('AI_EMPTY');
        return text.text;
    }

    return { complete };
}

function hasAnthropicCredential() {
    return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0;
}

module.exports = { createAnthropicProvider, hasAnthropicCredential };
