var libstream = require('stream'),
    bufferid = 0,
    utils = module.exports,
    dry = require('./json-dry'),
    net = require('net');

/**
 * Simple series handler
 *
 * @author   slebetman
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @return   {Function}
 */
function series(tasks, callback) {

	var next,
	    fn;

	// Do we have any more async functions to execute?
	if (tasks.length) {
		// Get the function we want to execute:
		fn = tasks.shift();

		// Build a nested callback to process remaining functions:
		next = function next() {
			series(tasks, callback);
		};

		// Call the function
		fn(next);
	} else {
		// Nothing left to process? Then call the final callback:
		callback();
	}
}

/**
 * Simple parallel handler
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 *
 * @return   {Function}
 */
function parallel(tasks, callback) {

	var done = 0,
	    next,
	    fn,
	    i;

	if (!tasks.length) {
		return callback();
	}

	next = function() {
		done++;
		if (done == tasks.length) {
			return callback();
		}
	};

	for (i = 0; i < tasks.length; i++) {
		tasks[i](next);
	}
}

module.exports.series = series;
module.exports.parallel = parallel;

/**
 * Wait for buffers before executing a function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.1
 * @version  0.1.3
 */
module.exports.waitForBuffers = function waitForBuffers(msg, callback) {

	var holder = this,
	    buffers = [],
	    tasks;

	// Create a task for every buffer we need to get
	tasks = msg.buffers.map(function eachBuffer(data, index) {
		return function getBuffer(next) {

			// Create an empty buffer
			var buffer,
			    sock;

			sock = new net.Socket();

			// Connect to the socket server
			sock.connect(data.bufferid);

			// Listen for data
			sock.on('data', function gotChunk(chunk) {
				if (!buffer) {
					buffer = chunk;
				} else {
					buffer = Buffer.concat([buffer, chunk]);
				}
			});

			sock.on('end', function gotBuffer() {
				buffers[index] = buffer;
				next();
			});
		};
	});

	// Start performing the tasks in series
	parallel(tasks, function gotAllBuffers() {

		msg.readyBuffers = buffers;

		callback(null);

		return

		var obj = {
			string: msg.args || msg.response,
			buffers: buffers
		};

		callback(null, dry.undry(obj));
	});
};

/**
 * Wait for streams before executing a function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
module.exports.waitForStreams = function waitForStreams(msg, callback) {

	var holder = this,
	    streams = [],
	    tasks;

	// Create a task for every buffer we need to get
	msg.streams.map(function eachStream(data, index) {

		// Create an empty buffer
		var stream = new libstream.PassThrough(),
		    sock;

		streams[index] = stream;

		sock = new net.Socket();

		// Connect to the socket server
		sock.connect(data.streamid);

		// Listen for data
		sock.on('data', function gotChunk(chunk) {
			stream.write(chunk);
		});

		sock.on('end', function gotBuffer() {
			stream.end();
		});
	});

	msg.readyStreams = streams;

	callback(null);
};

/**
 * Send buffers to the other side
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
module.exports.sendBuffers = function sendBuffers(buffers, callback) {

	var tasks;

	tasks = buffers.map(function eachBuffer(buffer, index) {
		return function createServer(next) {

			var server;

			server = net.createServer(function onConnection(client) {

				// Send the buffer
				client.end(buffer);

				// Close the server
				server.close();
			});

			server.listen(buffer.bufferid, next);
		};
	});

	parallel(tasks, callback);
};

/**
 * Send streams to the other side
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
module.exports.sendStreams = function sendStreams(streams, callback) {

	var tasks;

	tasks = streams.map(function eachStream(stream, index) {

		stream.pause();

		return function createServer(next) {

			var server;

			server = net.createServer(function onConnection(client) {

				stream.on('data', function gotChunk(chunk) {
					client.write(chunk);
				});

				stream.on('end', function ended() {
					client.end();
					server.close();
				});

				stream.resume();
			});

			server.listen(stream.streamid, next);
		};
	});

	parallel(tasks, callback);
};

/**
 * Convert arguments to be sent to the other side
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
module.exports.convertArguments = function convertArguments(_args, callback) {

	var buffers = [],
	    streams = [],
	    packet,
	    buffer,
	    stream,
	    tasks,
	    temp,
	    args,
	    i;

	if (!Array.isArray(_args)) {
		args = new Array(_args.length);
		for (i = 0; i < _args.length; i++) {
			args[i] = _args[i];
		}
	} else {
		args = _args;
	}

	// Serialize the arguments using JSON-dry
	temp = dry.dry(args);

	// See if there were any buffers inside the arguments
	for (i = 0; i < temp.buffers.length; i++) {
		buffer = temp.buffers[i];
		buffer.bufferid = '/tmp/forkify-b-' + Date.now() + '-' + bufferid++;
		buffers.push({bufferid: buffer.bufferid, length: buffer.length});
	}

	// See if there were any streams inside the arguments
	for (i = 0; i < temp.streams.length; i++) {
		stream = temp.streams[i];
		stream.streamid = '/tmp/forkify-s-' + Date.now() + '-' + bufferid++;
		streams.push({streamid: stream.streamid});
	}

	packet = {
		args: temp.string,
		buffers: buffers,
		streams: streams
	};

	if (!buffers.length && !streams.length) {
		return callback(null, packet);
	}

	tasks = [];

	if (buffers.length) {
		tasks.push(function doBuffers(next) {
			utils.sendBuffers(temp.buffers, next);
		});
	}

	if (streams.length) {
		tasks.push(function doStreams(next) {
			utils.sendStreams(temp.streams, next);
		});
	}

	utils.parallel(tasks, function done() {
		callback(null, packet);
	});
};

/**
 * Revive arguments received from the other side
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
module.exports.reviveArguments = function reviveArguments(packet, callback) {

	var tasks = [];

	if (packet.buffers.length) {
		tasks.push(function doBuffers(next) {
			utils.waitForBuffers(packet, next);
		});
	}

	if (packet.streams.length) {
		tasks.push(function doStreams(next) {
			utils.waitForStreams(packet, next);
		});
	}

	utils.parallel(tasks, function done() {

		var data,
		    temp,
		    args;

		// Create temp object for undrying
		temp = {
			string: packet.args || packet.response,
			buffers: packet.readyBuffers,
			streams: packet.readyStreams
		};

		// Get the revived arguments
		args = dry.undry(temp);

		// Create the response data
		data = {
			fncid: packet.fncid,
			cbid: packet.cbid, // Can be undefined
			eid: packet.eid,
			args: args
		};

		callback(null, data);
	});
};


/**
 * Modified `emit` function for communication between processes
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 *
 * @param    {EventEmitter}   event
 * @param    {Number}         cbid
 */
module.exports.setEventEmitter = function setEventEmitter(holder, event, fncid, cbid) {

	// Store the old emitter
	var _emit = event.emit,
	    callbacks = [];

	event._emit = _emit;

	// Set the new emitter
	event.emit = function emit(type) {

		var args = [],
		    len = arguments.length,
		    eid,
		    cb,
		    i;

		// Emit locally first
		_emit.apply(event, arguments);

		cb = arguments[len - 1];

		// See if the last argument is a callback function
		if (typeof cb == 'function') {
			eid = callbacks.push(cb) - 1;
			len--;
		}

		for (i = 0; i < len; i++) {
			args[i] = arguments[i];
		}

		// Convert the arguments and send them to the fork
		utils.convertArguments(args, function done(err, packet) {

			packet.type = 'cbevent';
			packet.fncid = fncid;
			packet.cbid = cbid;
			packet.eid = eid;

			holder.send(packet);
		});
	};

	// Handle a received event from the other side
	event._handleEvent = function _handleEvent(packet) {
		utils.reviveArguments(packet, function done(err, data) {

			if (typeof packet.eid == 'number') {
				data.args.push(function callback() {
					utils.convertArguments(arguments, function done(err, respacket) {
						respacket.type = 'eventresponse';
						respacket.cbid = packet.cbid;
						respacket.eid = packet.eid;

						holder.send(respacket);
					});
				});
			}

			event._emit.apply(event, data.args);
		});
	};

	// Handle event responses from the other side
	event._handleResponse = function _handleResponse(packet) {
		utils.reviveArguments(packet, function done(err, data) {

			// Make sure the response callback actually exists
			if (callbacks[data.eid]) {
				// Execute the stored callback
				callbacks[data.eid].apply(event, data.args);

				// Remove the callback
				delete callbacks[data.eid];
			}
		});
	};
};