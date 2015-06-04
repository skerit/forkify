var libstream = require('stream'),
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