// Shared chat widget for every place the app uses AI (condition monitoring, intelligent sourcing).
// aiChat(selector, { endpoint, baseBody, suggestions, placeholder }) renders a read-only chat into the element.
// baseBody() returns the fixed request fields (asset id, item id, ...); the widget adds message + the last turns.
// The server answers only from its own bounded context; nothing the user types is trusted there (see services/ai/chat.js).

function aiChat(selector, options) {

    var MAX_TURNS = 6;
    var history   = [];
    var busy      = false;
    var root      = $(selector).addClass('ai-chat').empty();

    function esc(text) { return $('<div></div>').text(text == null ? '' : String(text)).html(); }

    root.append(
        '<div class="ai-chat-title">Chat mit dem Assistenten</div>' +
        '<div class="ai-chat-note">AI Interpretation – antwortet nur aus den hier gezeigten Daten, nur lesend, nichts wird geschrieben.</div>' +
        '<div class="ai-chat-suggest"></div>' +
        '<div class="ai-chat-log" aria-live="polite"></div>' +
        '<form class="ai-chat-form"><input class="ai-chat-input" type="text" maxlength="500" autocomplete="off" placeholder="' + esc(options.placeholder || 'Frage stellen …') + '">' +
        '<button class="button ai-chat-send" type="submit">Senden</button></form>');

    var log   = root.find('.ai-chat-log');
    var input = root.find('.ai-chat-input');
    var send  = root.find('.ai-chat-send');

    (options.suggestions || []).forEach(function(text) {
        $('<button type="button" class="ai-chat-chip"></button>').text(text).appendTo(root.find('.ai-chat-suggest'))
            .on('click', function() { ask(text); });
    });

    root.find('.ai-chat-form').on('submit', function(event) {
        event.preventDefault();
        ask(input.val());
    });

    function bubble(role, html) {
        var elem = $('<div class="ai-chat-msg ai-chat-' + role + '"></div>').html(html).appendTo(log);
        log.scrollTop(log[0].scrollHeight);
        return elem;
    }

    function list(title, items) {
        if(!items || !items.length) return '';
        return '<div class="ai-chat-list-title">' + title + '</div><ul>' + items.map(function(i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }

    function errorText(xhr) {
        if(xhr.status === 429) return 'Zu viele Chat-Anfragen. Bitte später erneut versuchen.';
        if(xhr.status === 503) return 'Die KI ist auf diesem Server nicht verfügbar (deaktiviert oder kein Zugang).';
        if(xhr.status === 409) return 'Die Antwort wurde verworfen, weil sie dem technischen Ergebnis widersprach.';
        if(xhr.status === 400) return 'Die Frage konnte nicht verarbeitet werden (1–500 Zeichen).';
        return 'Die Antwort konnte nicht erzeugt werden.';
    }

    function ask(text) {
        text = String(text || '').trim();
        if(!text || busy) return;

        busy = true;
        input.val('').prop('disabled', true);
        send.prop('disabled', true);
        bubble('user', esc(text));
        var wait = bubble('bot', '<span class="ai-chat-wait">Antwort wird erzeugt …</span>');

        $.ajax({
            url         : options.endpoint,
            method      : 'POST',
            contentType : 'application/json',
            dataType    : 'json',
            data        : JSON.stringify($.extend({}, options.baseBody(), { message : text, history : history.slice(-MAX_TURNS) }))
        }).done(function(response) {
            var i = (response.data && response.data.insight) || {};
            wait.html('<div class="ai-chat-answer">' + esc(i.answer) + '</div>' +
                list('Belege', i.evidence) + (i.sources && i.sources.length ? '<div class="ai-chat-sources">Quellen: ' + i.sources.map(esc).join(' · ') + '</div>' : '') + list('Offen', i.openItems) +
                '<div class="ai-chat-meta">' + (response.data.cached ? 'aus Zwischenspeicher' : 'live') + (i.confidence ? ' · Sicherheit: ' + esc(i.confidence) : '') + '</div>');
            history.push({ role : 'user', text : text }, { role : 'assistant', text : String(i.answer || '') });
            history = history.slice(-MAX_TURNS);
        }).fail(function(xhr) {
            wait.addClass('ai-chat-error').html(esc(errorText(xhr)));
        }).always(function() {
            busy = false;
            input.prop('disabled', false).focus();
            send.prop('disabled', false);
            log.scrollTop(log[0].scrollHeight);
        });
    }

    return { ask : ask };
}
