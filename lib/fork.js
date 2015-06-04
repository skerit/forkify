var toobusy = require('toobusy-js'),
    utils = require('./utils'),
    dry = require('./json-dry'),
    functions = [],
    instanceId = Number(process.argv[2]),
    bufferid = 0;

// Set the buffer function handler
process.waitForBuffers = utils.waitForBuffers;
process.waitForStreams = utils.waitForStreams;

/**
 * Return an object for json-drying this error
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Object}
 */
Object.defineProperty(Error.prototype, 'toDry', {
	enumerable: false,
	configurable: false,
	writable: false,
	value: function toDry() {
		return {
			value: {
				message: this.message,
				stack: this.stack
			},
			path: 'ForkError'
		};
	}
});

/**
 * Listen to messages coming from the parent instance
 *
 * @author   Jelle De Loecker   <jelle@codedor.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param   {Object}   msg
 */
process.on('message', function onMessage(msg) {

	var tasks = [];

	switch (msg.type) {

		case 'wrap':
			storeWrapper(msg.fnc, msg.id);
			break;

		case 'exec':

			if (msg.buffers.length) {
				tasks.push(function doBuffers(next) {
					process.waitForBuffers(msg, next);
				});
			}

			if (msg.streams.length) {
				tasks.push(function doStreams(next) {
					process.waitForStreams(msg, next);
				});
			}

			utils.parallel(tasks, function done() {

				var obj = {
					string: msg.args || msg.response,
					buffers: msg.readyBuffers,
					streams: msg.readyStreams
				};

				execFunction(msg.fncid, msg.cbid, dry.undry(obj));
			});
			break;

		case 'event':
			process.emit(msg.name);
			break;

		default:
			console.log('Got unknown message from parent:', msg);
	}
});

/**
 * Send a ping to the parent
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function sendPing() {
	process.send({type: 'ping', lag: toobusy.lag()});
}

// Send this ping every 2.5 seconds
setInterval(sendPing, 2500).unref();

/**
 * Store the gotten function in this wrapper
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function storeWrapper(fncString, id) {

	var fnc;

	// Eval the function string
	eval('fnc = ' + fncString);

	// Store it in the object
	functions[id] = fnc;
};

/**
 * Execute a stored function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function execFunction(fncid, cbid, args) {

	var ctx = {},
	    fnc = functions[fncid],
	    cb;

	if (!fnc) {
		return console.error('Could not find function id', fncid);
	}

	sendPing();

	if (cbid != null) {
		cb = function callback() {

			var resargs = [],
			    buffers = [],
			    streams = [],
			    buffer,
			    stream,
			    tasks = [],
			    data,
			    i;

			for (i = 0; i < arguments.length; i++) {
				resargs.push(arguments[i]);
			}

			resargs = dry.dry(resargs);

			// See if there were any buffers inside the arguments
			for (i = 0; i < resargs.buffers.length; i++) {
				buffer = resargs.buffers[i];
				buffer.bufferid = '/tmp/forkify-b-' + Date.now() + '-' + bufferid++;
				buffers.push({bufferid: buffer.bufferid, length: buffer.length});
			}

			// See if there were any buffers inside the arguments
			for (i = 0; i < resargs.streams.length; i++) {
				stream = resargs.streams[i];
				stream.streamid = '/tmp/forkify-s-' + Date.now() + '-' + bufferid++;
				streams.push({streamid: stream.streamid});
			}

			data = {
				type: 'callback',
				cbid: cbid,
				response: resargs.string,
				buffers: buffers,
				streams: streams
			};

			if (!resargs.buffers.length && !resargs.streams.length) {
				return process.send(data);
			}

			if (buffers.length) {
				tasks.push(function doBuffers(next) {
					utils.sendBuffers(resargs.buffers, next);
				});
			}

			if (streams.length) {
				tasks.push(function doStreams(next) {
					utils.sendStreams(resargs.streams, next);
				});
			}

			utils.parallel(tasks, function done() {
				process.send(data);
			});
		};

		args.push(cb);
	}

	ctx.emit = function emitToParent(type) {

		var args = [],
		    obj = {},
		    i;

		for (i = 1; i < arguments.length; i++) {
			args.push(arguments[i]);
		}

		obj.type = type;
		obj.args = args;

		process.send({type: 'event', name: 'fnc-exec-event-' + cbid, args: obj});
	};

	try {
		fnc.apply(ctx, args);
	} catch (err) {
		if (cb) {
			cb(err);
		} else {
			console.error('Uncaught worker error:', err);
		}
	}
};