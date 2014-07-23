Faye.Transport.WebSocket = Faye.extend(Faye.Class(Faye.Transport, {
  UNCONNECTED:  1,
  CONNECTING:   2,
  CONNECTED:    3,

  batching:     false,

  isUsable: function(callback, context) {
    this.callback(function() { callback.call(context, true) });
    this.errback(function() { callback.call(context, false) });
    this.connect();
  },

  request: function(messages) {
    this._pending = this._pending || new Faye.Set();
    for (var i = 0, n = messages.length; i < n; i++) this._pending.add(messages[i]);

    this.callback(function(socket) {
      if (!socket) {
        this.info('Cancelling request as socket has been closed');
        // Should we this._handleError(messages);
        return;
      }

      if (socket.readyState !== 1) {
        this._handleError(messages);
        return;
      }

      try {
        socket.send(Faye.toJSON(messages));
      } catch(e) {
        this._handleError(messages);
      }
    }, this);

    this.connect();
    var self = this;

    return {
      abort: function() {
        self.callback(function(socket) { socket.close() });
      }
    };
  },

  connect: function() {
    if (Faye.Transport.WebSocket._unloaded) return;

    this._state = this._state || this.UNCONNECTED;
    if (this._state !== this.UNCONNECTED) return;
    this._state = this.CONNECTING;

    this.info('Websocket transport attempting connection');

    var socket = this._createSocket();
    if (!socket) {
      this.info('Unable to create websocket');
      return this.setDeferredStatus('failed');
    }

    var self = this;

    socket.onopen = function() {
      self.info('Websocket socket opened successfully');

      if (socket.headers) self._storeCookies(socket.headers['set-cookie']);
      self._socket = socket;
      self._state = self.CONNECTED;
      self._everConnected = true;
      self._ping();
      self.setDeferredStatus('succeeded', socket);
    };

    var closed = false;
    socket.onclose = socket.onerror = function(event) {
      if (closed) return;
      closed = true;

      self._invalidateSocket();

      if (self._closing) {
        self.info('Websocket closed as expected. code ?, reason ?, wasClean ?', event && event.code, event && event.reason, event && event.wasClean);
      } else {
        self.warn('Websocket closed unexpectedly. code ?, reason ?, wasClean ?', event && event.code, event && event.reason, event && event.wasClean);
        Faye.Transport.WebSocket._faultCount++;
      }

      var wasConnected = (self._state === self.CONNECTED);
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;

      delete self._socket;
      self._state = self.UNCONNECTED;
      self.removeTimeout('ping');
      self.removeTimeout('pingTimeout');
      self.setDeferredStatus('unknown');

      var pending = self._pending ? self._pending.toArray() : [];
      delete self._pending;

      if (wasConnected) {
        self._handleError(pending, true);
      } else if (self._everConnected) {
        self._handleError(pending);
      } else {
        self.setDeferredStatus('failed');
      }
    };

    socket.onmessage = function(event) {
      self.debug('Websocket message received');
      var replies = JSON.parse(event.data);
      if (!replies) return;

      replies = [].concat(replies);
      self.removeTimeout('pingTimeout');

      for (var i = 0, n = replies.length; i < n; i++) {
        if (replies[i].successful === undefined) continue;
        self._pending.remove(replies[i]);
      }
      self._receive(replies);
    };
  },

  close: function() {
    if (!this._socket) return;
    this._closing = true;
    this.info('Websocket transport close requested');
    this._socket.close();
    this._invalidateSocket();
  },

  _createSocket: function() {
    var url     = Faye.Transport.WebSocket.getSocketUrl(this.endpoint),
        headers = Faye.copyObject(this._dispatcher.headers),
        options = {headers: headers, ca: this._dispatcher.ca};

    options.headers['Cookie'] = this._getCookies();

    if (Faye.WebSocket)        return new Faye.WebSocket.Client(url, [], options);
    if (Faye.ENV.MozWebSocket) return new MozWebSocket(url);
    if (Faye.ENV.WebSocket)    return new WebSocket(url);
  },

  _invalidateSocket: function() {
    if(this._dispatcher.transports && this._dispatcher.transports.websocket) {
      delete this._dispatcher.transports.websocket[this.endpoint.href];
    }
  },

  _ping: function() {
    if (!this._socket) return;

    if (this._socket.readyState !== 1) {
      this.warn('Websocket unable to send. readyState=?', this._socket.readyState);
      this.close();
      return;
    }

    this.debug('Websocket transport ping');

    try {
      this._socket.send('[]');
    } catch(e) {
      this.warn('Websocket ping failed: ?', e);
      this.close();
      return;
    }

    this.addTimeout('ping', this._dispatcher.timeout / 2, this._ping, this);
    this.addTimeout('pingTimeout', this._dispatcher.timeout / 1.5, this._pingTimeout, this);
  },

  _pingTimeout: function() {
    this.info('Ping timeout');
    this.close();
  }

}), {
  PROTOCOLS: {
    'http:':  'ws:',
    'https:': 'wss:'
  },

  _faultCount: 0,

  create: function(dispatcher, endpoint) {
    var sockets = dispatcher.transports.websocket = dispatcher.transports.websocket || {};
    sockets[endpoint.href] = sockets[endpoint.href] || new this(dispatcher, endpoint);
    return sockets[endpoint.href];
  },

  getSocketUrl: function(endpoint) {
    endpoint = Faye.copyObject(endpoint);
    endpoint.protocol = this.PROTOCOLS[endpoint.protocol];
    return Faye.URI.stringify(endpoint);
  },

  isUsable: function(dispatcher, endpoint, callback, context) {
    if(this._faultCount > 10) {
      return callback.call(context, false);
    }
    this.create(dispatcher, endpoint).isUsable(callback, context);
  }
});

Faye.extend(Faye.Transport.WebSocket.prototype, Faye.Deferrable);
Faye.Transport.register('websocket', Faye.Transport.WebSocket);

if (Faye.Event && Faye.ENV.onbeforeunload !== undefined)
  Faye.Event.on(Faye.ENV, 'beforeunload', function() {
    Faye.Transport.WebSocket._unloaded = true;
  });
