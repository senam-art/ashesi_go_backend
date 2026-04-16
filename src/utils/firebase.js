const admin = require('firebase-admin');
// Ensure you point to wherever you saved your service account key
const serviceAccount = require('../../serviceAccountKey.json'); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const messaging = admin.messaging();

/**
 * Sends a notification to a specific topic (e.g., 'route_123' or 'all_shuttles')
 */
const sendStopNotification = async (topic, routeName, stopName) => {
  const message = {
    notification: {
      title: 'Bus Arriving! 🚌',
      body: `The ${routeName} shuttle has reached ${stopName}.`,
    },
    // We send to the topic for the specific route
    topic: topic, 
  };

  try {
    const response = await messaging.send(message);
    console.log('Successfully sent notification:', response);
    return response;
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};

module.exports = { sendStopNotification };