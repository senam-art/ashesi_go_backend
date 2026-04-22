const admin = require('firebase-admin');
const { logLine } = require('./verboseLog');

const serviceAccount = JSON.parse(
  Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString()
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const messaging = admin.messaging();

/**
 * Sends a bus-arrival notification to the two passenger-facing topics:
 *   passengers_route_<id>         - passengers watching this route
 *   passengers_all_shuttles       - passengers who opted into all routes
 *
 * Drivers are intentionally NOT targeted by arrival pings; they get their
 * own UI feedback when they slide the Arrive/Depart control.
 */
const sendStopNotification = async (routeId, routeName, stopName) => {
  const title = 'Bus Arriving! 🚌';
  const body = `The ${routeName} shuttle has reached ${stopName}.`;

  logLine('fcm', `sendStopNotification routeId=${routeId} stopName=${stopName}`);

  const targets = [
    `passengers_route_${routeId}`,
    'passengers_all_shuttles',
  ];

  const results = [];
  for (const topic of targets) {
    try {
      logLine('fcm', `sending to topic=${topic}`);
      const response = await messaging.send({
        notification: { title, body },
        topic,
        data: {
          route_id: String(routeId),
          stop_name: stopName,
          kind: 'bus_arrival',
        },
      });
      logLine('fcm', `sent OK topic=${topic} messageId=${response}`);
      results.push({ topic, messageId: response });
    } catch (error) {
      console.error(`FCM send to ${topic} failed:`, error.message);
      logLine('fcm', `send FAILED topic=${topic} err=${error.message}`);
      results.push({ topic, error: error.message });
    }
  }

  logLine('fcm', 'sendStopNotification complete', results);
  return results;
};

/**
 * Sends a high-priority operational broadcast from drivers to all app users.
 * Topic contract:
 *   all_users - every signed-in device should subscribe to this topic.
 */
const sendGlobalDriverAlert = async ({
  title,
  body,
  data = {},
  topic = 'all_users',
}) => {
  const payload = {
    notification: { title, body },
    topic,
    data: {
      kind: 'driver_broadcast',
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])
      ),
    },
  };

  try {
    logLine('fcm', `sendGlobalDriverAlert topic=${topic} title="${title}"`);
    const messageId = await messaging.send(payload);
    logLine('fcm', `sendGlobalDriverAlert OK messageId=${messageId}`);
    return { ok: true, topic, messageId };
  } catch (error) {
    console.error(`FCM global alert to ${topic} failed:`, error.message);
    logLine('fcm', `sendGlobalDriverAlert FAILED topic=${topic} err=${error.message}`);
    return { ok: false, topic, error: error.message };
  }
};

module.exports = { sendStopNotification, sendGlobalDriverAlert };
