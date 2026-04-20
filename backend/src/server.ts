import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3001;

// Core data interfaces
interface Location {
  lat: number;
  lng: number;
  speed?: number;
  timestamp: number;
}

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface Session {
  driverCode: string;
  status: 'active' | 'inactive';
  driverSocketId?: string;
  stops: Stop[];
  lastLocation?: Location;
  createdAt: number;
}

// In-memory sessions store
let sessions: Record<string, Session> = {};

// Helper to generate a human-readable, unique driver code (VIT-XXXX)
// Excludes ambiguous characters (0, O, 1, I, etc.)
function generateDriverCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let attempts = 0;
  
  while (attempts < 1000) {
    let randomPart = '';
    for (let i = 0; i < 4; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = `VIT-${randomPart}`;
    
    // Ensure uniqueness among active/inactive sessions
    if (!sessions[code]) {
      return code;
    }
    attempts++;
  }
  return `VIT-${Date.now().toString().slice(-4)}`;
}

// REST APIs
// Create a new tracking session (called by driver when starting a ride)
app.post('/api/sessions', (req, res) => {
  const { stops } = req.body;
  const driverCode = generateDriverCode();
  
  const newSession: Session = {
    driverCode,
    status: 'inactive', // becomes active once socket joins
    stops: stops || [],
    createdAt: Date.now(),
  };
  
  sessions[driverCode] = newSession;
  console.log(`Created new session: ${driverCode}`);
  res.status(201).json(newSession);
});

// Fetch info for a specific driver code
app.get('/api/sessions/:driverCode', (req, res) => {
  const { driverCode } = req.params;
  const upperCode = driverCode.toUpperCase();
  
  const session = sessions[upperCode];
  if (!session) {
    return res.status(404).json({ error: 'Driver code not found' });
  }
  res.json(session);
});

// Update stops for a session dynamically
app.post('/api/sessions/:driverCode/stops', (req, res) => {
  const { driverCode } = req.params;
  const { stops } = req.body;
  const upperCode = driverCode.toUpperCase();
  
  const session = sessions[upperCode];
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  session.stops = stops || [];
  res.json(session);
});

// WebSockets (Real-Time Communication)
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Client joins a driver code session room
  socket.on('join-session', ({ driverCode, role }) => {
    const upperCode = driverCode.toUpperCase();
    socket.join(upperCode);
    console.log(`Socket ${socket.id} joined room ${upperCode} as ${role}`);

    const session = sessions[upperCode];
    if (session) {
      if (role === 'driver') {
        session.status = 'active';
        session.driverSocketId = socket.id;
        
        // Clear grace period timeout if driver reconnects
        if ((session as any).disconnectTimeoutId) {
          clearTimeout((session as any).disconnectTimeoutId);
          (session as any).disconnectTimeoutId = undefined;
          console.log(`Driver reconnected to session ${upperCode}. Grace period canceled.`);
        }
      }
      // Send the current session state to the joining socket (especially for late-joining students)
      socket.emit('session-state', session);
      // Alert room of update
      io.to(upperCode).emit('session-updated', session);
    } else {
      // If code was not registered via HTTP yet, register a basic one on the fly
      if (role === 'driver') {
        sessions[upperCode] = {
          driverCode: upperCode,
          status: 'active',
          driverSocketId: socket.id,
          stops: [],
          createdAt: Date.now(),
        };
        socket.emit('session-state', sessions[upperCode]);
      } else {
        socket.emit('session-error', { message: 'Invalid Driver Code. Please verify.' });
      }
    }
  });

  // Driver broadcasts updated coordinates
  socket.on('update-location', ({ driverCode, lat, lng, speed, stops }) => {
    const upperCode = driverCode.toUpperCase();
    const session = sessions[upperCode];
    
    console.log(`Location update for ${upperCode}: lat=${lat}, lng=${lng}`);
    const locationData: Location = {
      lat,
      lng,
      speed,
      timestamp: Date.now(),
    };

    if (session) {
      session.status = 'active';
      session.lastLocation = locationData;
      session.driverSocketId = socket.id;
      if (stops) {
        session.stops = stops;
      }
      
      // Clear grace period timeout if location updates keep coming in
      if ((session as any).disconnectTimeoutId) {
        clearTimeout((session as any).disconnectTimeoutId);
        (session as any).disconnectTimeoutId = undefined;
        console.log(`Driver updated location for session ${upperCode}. Grace period canceled.`);
      }
    }

    // Broadcast the updated telemetry to students listening in the room
    socket.to(upperCode).emit('location-updated', {
      driverCode: upperCode,
      location: locationData,
      stops: session?.stops || stops,
    });
  });

  // Driver stops the ride
  socket.on('stop-session', ({ driverCode }) => {
    const upperCode = driverCode.toUpperCase();
    console.log(`Driver stopped session: ${upperCode}`);
    const session = sessions[upperCode];
    
    if (session) {
      session.status = 'inactive';
      session.driverSocketId = undefined;
    }
    
    // Broadcast end of ride
    socket.to(upperCode).emit('session-stopped', { driverCode: upperCode });
    
    // Clean up from memory to keep store tidy (or preserve for history)
    // For now we keep it so students can see the offline state, but clean up after 2 hours
  });

  // Handle sudden disconnections (e.g. signal drops or tab closes)
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Check if this socket belonged to a driver
    for (const code in sessions) {
      const session = sessions[code];
      if (session.driverSocketId === socket.id) {
        console.log(`Driver disconnected abruptly from session ${code}. Waiting 35s grace period...`);
        
        // Wait 35 seconds before declaring offline, to handle phone calls or background switching
        (session as any).disconnectTimeoutId = setTimeout(() => {
          console.log(`Grace period expired. Marking session ${code} as inactive.`);
          session.status = 'inactive';
          session.driverSocketId = undefined;
          io.to(code).emit('session-stopped', { driverCode: code });
        }, 35000);
      }
    }
  });
});

// Periodic memory clean up for sessions older than 12 hours
setInterval(() => {
  const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
  for (const code in sessions) {
    if (sessions[code].createdAt < twelveHoursAgo) {
      console.log(`Cleaning up old session: ${code}`);
      delete sessions[code];
    }
  }
}, 60 * 60 * 1000); // run every hour

server.listen(PORT, () => {
  console.log(`VanOla Server running on port ${PORT}`);
});
