Faye.Dispatcher = Faye.Class({
  MAX_REQUEST_SIZE: 2048,
  DEFAULT_RETRY:    5,

  UP:   1,
  DOWN: 2,

  initialize: function(client, endpoint, options) {
    this._client     = client;
    this.endpoint    = Faye.URI.parse(endpoint);
    this._alternates = options.endpoints || {};

    this.ca         = options.ca;
    this.cookies    = Faye.Cookies && new Faye.Cookies.CookieJar();
    this._disabled  = [];
    this._envelopes = {};
    this.headers    = {};
    this.retry      = options.retry || this.DEFAULT_RETRY;
    this._state     = 0;
    this.transports = {};

    for (var type in this._alternates)
      this._alternates[type] = Faye.URI.parse(this._alternates[type]);

    this.maxRequestSize = this.MAX_REQUEST_SIZE;
  },

  endpointFor: function(connectionType) {
    return this._alternates[connectionType] || this.endpoint;
  },

  disable: function(feature) {
    this._disabled.push(feature);
  },

  setHeader: function(name, value) {
    this.headers[name] = value;
  },

  reset: function() {
    this.close();
    var transports = this.transports.websocket;
    if(transports) {
      this.transports.websocket = {};

      for(var key in transports) {
        if(transports.hasOwnProperty(key)) {
          var transport = transports[key];
          if(transport) transport.close();
        }
      }
    }

  },

  close: function() {
    var transport = this._transport;
    delete this._transport;
    if (transport) {
      this.info('Dispatch close to close transport.');
      transport.close();
    }
  },

  selectTransport: function(transportTypes) {
    Faye.Transport.get(this, transportTypes, this._disabled, function(transport) {
      this.debug('Selected ? transport for ?', transport.connectionType, Faye.URI.stringify(transport.endpoint));

      if (transport === this._transport) return;
      if (this._transport) this._transport.close();

      this._transport = transport;
      this.connectionType = transport.connectionType;
    }, this);
  },

  sendMessage: function(message, timeout, options) {
    if (!this._transport) return;
    options = options || {};

    var self     = this,
        id       = message.id,
        attempts = options.attempts,
        deadline = options.deadline && new Date().getTime() + (options.deadline * 1000),

        envelope = this._envelopes[id] = this._envelopes[id] ||
                   {message: message, timeout: timeout, attempts: attempts, deadline: deadline};

    if (envelope.request || envelope.timer) return;

    if (this._attemptsExhausted(envelope) || this._deadlinePassed(envelope)) {
      delete this._envelopes[id];
      return;
    }

    envelope.timer = Faye.ENV.setTimeout(function() {
      self.handleError(message);
    }, timeout * 1000);

    envelope.request = this._transport.sendMessage(message);
  },

  handleResponse: function(reply) {
    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      delete this._envelopes[reply.id];
      Faye.ENV.clearTimeout(envelope.timer);
    }

    this.trigger('message', reply);

    if (this._state === this.UP) return;
    this._state = this.UP;
    this._client.trigger('transport:up');
  },

  handleError: function(message, immediate) {
    var envelope = this._envelopes[message.id],
        request  = envelope && envelope.request,
        self     = this;

    if (!request) return;

    this.debug('handleError');

    request.then(function(req) {
      if (req && req.abort) {
        self.debug('Aborting request');
        req.abort();
      }
    });

    Faye.ENV.clearTimeout(envelope.timer);
    envelope.request = envelope.timer = null;

    if (immediate) {
      this.debug('Retrying message#? delivery immediately', message.id);
      this.sendMessage(envelope.message, envelope.timeout);
    } else {
      this.debug('Retrying message#? delivery after timeout', message.id);
      envelope.timer = Faye.ENV.setTimeout(function() {
        self.debug('Attempting redelivery of failed message');
        envelope.timer = null;
        self.sendMessage(envelope.message, envelope.timeout);
      }, this.retry * 1000);
    }

    if (this._state === this.DOWN) return;
    this._state = this.DOWN;
    this._client.trigger('transport:down');
  },

  _attemptsExhausted: function(envelope) {
    if (envelope.attempts === undefined) return false;
    envelope.attempts -= 1;
    if (envelope.attempts >= 0) return false;
    return true;
  },

  _deadlinePassed: function(envelope) {
    var deadline = envelope.deadline;
    if (deadline === undefined) return false;
    if (new Date().getTime() <= deadline) return false;
    return true;
  }
});

Faye.extend(Faye.Dispatcher.prototype, Faye.Publisher);
Faye.extend(Faye.Dispatcher.prototype, Faye.Logging);
