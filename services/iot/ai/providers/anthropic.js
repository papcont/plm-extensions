// Anthropic provider for the IoT AI service. Single read-only call: no tools, structured JSON output.
// The key comes from config (environment.js iot.ai.apiKey) or the SDK's own ANTHROPIC_API_KEY lookup.

const Anthropic = require('@anthropic-ai/sdk');

// Exactly the configured model, one request, no SDK retry, no fallback model, no tools.
const MAX_OUTPUT_TOKENS = 2500;

function createAnthropicProvider(config, client) {
    client = client || new Anthropic({ apiKey: config.apiKey || undefined, timeout: 60000, maxRetries: 0 });

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

module.exports = { createAnthropicProvider };
