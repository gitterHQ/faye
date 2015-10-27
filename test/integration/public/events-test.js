var Faye = require('../../..');
var fetch = require('../fetch');
var assert = require('assert');

describe('client events', function() {
  this.timeout(10000000);
  var client;
  var eventQueue = [];

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8001/bayeux', { timeout: 45 });
    client.on('handshake:success', function() {
      eventQueue.push('handshake:success');
    });
  });

  afterEach(function() {
    client.disconnect();
    client.off('handshake');
  });

  it('should emit events', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count >= 3) {
        assert.deepEqual(eventQueue, ['handshake']);
        done();
      }
    });

    subscription.catch(function() {
      done(err);
    });

  });

});
