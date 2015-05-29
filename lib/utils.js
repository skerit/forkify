var dry = require('./json-dry');

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

module.exports.series = series;

/**
 * Wait for buffers before executing a function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
module.exports.waitForBuffers = function waitForBuffers(msg, callback) {

	var holder = this;

	// Wait for the message we can receive buffers
	holder.waiters.push(function canReceiveBuffers() {

		var tasks = [],
		    buffers = [];

		// Lock the buffer stream
		holder.bufferlock = true;

		// Create a task for every buffer we need to get
		msg.buffers.forEach(function eachBuffer(data, index) {
			tasks.push(function getBuffer(next) {

				// Create an empty buffer
				var buffer = new Buffer(0);

				// Set the aggregator
				holder.aggregator = function gotChunk(chunk) {
					buffer = Buffer.concat([buffer, chunk]);

					if (buffer.length == data.length) {
						buffers.push(buffer);
						next();
					}
				};

				holder.send({type: 'event', name: 'ready-for-buffer-' + data.bufferid});
			});
		});

		// Start performing the tasks in series
		series(tasks, function gotAllBuffers() {

			var obj = {
				string: msg.args || msg.response,
				buffers: buffers
			};

			// Release the lock on the stream
			holder.bufferlock = false;
			holder.aggregator = null;
			holder.emit('can-receive-buffers');

			//holder.handleCallback(msg.cbid, dry.undry(obj));
			callback(null, dry.undry(obj));
		});
	});

	if (!holder.bufferlock) {
		holder.emit('can-receive-buffers');
	}
};