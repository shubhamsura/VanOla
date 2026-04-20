import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

const app = express();

// Security Headers
app.use(helmet());

// Restrict CORS origins (Allow environment specified frontend or allow all for local testing)
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// General API rate limiter to protect against DoS attacks
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // limit each IP to 150 requests per window
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for creating new driver sessions
const createSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // limit to 30 session creations per hour per IP
  message: { error: 'Too many session creation attempts. Please try again later.' },
});

app.use('/api/', apiLimiter);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
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
  driverToken: string; // Secret authorization token for the session driver
  status: 'active' | 'inactive';
  driverSocketId?: string;
  stops: Stop[];
  lastLocation?: Location;
  createdAt: number;
}

// In-memory sessions store
let sessions: Record<string, Session> = {};

// Helper to generate a human-readable, unique driver code (VIT-XXXX)
function generateDriverCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let attempts = 0;
  
  while (attempts < 1000) {
    let randomPart = '';
    for (let i = 0; i < 4; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = `VIT-${randomPart}`;
    
    if (!sessions[code]) {
      return code;
    }
    attempts++;
  }
  return `VIT-${Date.now().toString().slice(-4)}`;
}

// Helper to strip sensitive server-only fields before sending to public clients
function toPublicSession(session: Session) {
  const { driverToken, ...publicData } = session;
  return publicData;
}

// REST APIs
// Create a new tracking session (called by driver when starting a ride)
app.post('/api/sessions', createSessionLimiter, (req, res) => {
  const { stops } = req.body;
  const driverCode = generateDriverCode();
  const driverToken = crypto.randomBytes(16).toString('hex');
  
  const newSession: Session = {
    driverCode,
    driverToken,
    status: 'inactive', // becomes active once socket joins
    stops: stops || [],
    createdAt: Date.now(),
  };
  
  sessions[driverCode] = newSession;
  console.log(`Created new session: ${driverCode}`);
  // Return full session including driverToken ONLY to the creator (driver)
  res.status(201).json(newSession);
});

// Fetch public info for a specific driver code
app.get('/api/sessions/:driverCode', (req, res) => {
  const { driverCode } = req.params;
  const upperCode = driverCode.toUpperCase();
  
  const session = sessions[upperCode];
  if (!session) {
    return res.status(404).json({ error: 'Driver code not found' });
  }
  res.json(toPublicSession(session));
});

// Update stops for a session dynamically
app.post('/api/sessions/:driverCode/stops', (req, res) => {
  const { driverCode } = req.params;
  const { stops, driverToken } = req.body;
  const upperCode = driverCode.toUpperCase();
  
  const session = sessions[upperCode];
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.driverToken && session.driverToken !== driverToken) {
    return res.status(403).json({ error: 'Unauthorized: Invalid driver token' });
  }
  
  session.stops = stops || [];
  res.json(toPublicSession(session));
});

// WebSockets (Real-Time Communication)
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Client joins a driver code session room
  socket.on('join-session', ({ driverCode, role, driverToken }) => {
    const upperCode = driverCode.toUpperCase();
    socket.join(upperCode);
    console.log(`Socket ${socket.id} joined room ${upperCode} as ${role}`);

    const session = sessions[upperCode];
    if (session) {
      if (role === 'driver') {
        // Authenticate driver token if present
        if (session.driverToken && driverToken && session.driverToken !== driverToken) {
          console.warn(`Unauthorized driver join attempt for ${upperCode}`);
          socket.emit('session-error', { message: 'Unauthorized driver token.' });
          return;
        }
        
        session.status = 'active';
        session.driverSocketId = socket.id;
        
        if ((session as any).disconnectTimeoutId) {
          clearTimeout((session as any).disconnectTimeoutId);
          (session as any).disconnectTimeoutId = undefined;
          console.log(`Driver reconnected to session ${upperCode}. Grace period canceled.`);
        }
      }
      // Send the current session state to the joining socket
      socket.emit('session-state', toPublicSession(session));
      // Alert room of update
      io.to(upperCode).emit('session-updated', toPublicSession(session));
    } else {
      if (role === 'driver') {
        const token = driverToken || crypto.randomBytes(16).toString('hex');
        sessions[upperCode] = {
          driverCode: upperCode,
          driverToken: token,
          status: 'active',
          driverSocketId: socket.id,
          stops: [],
          createdAt: Date.now(),
        };
        socket.emit('session-state', toPublicSession(sessions[upperCode]));
      } else {
        socket.emit('session-error', { message: 'Invalid Driver Code. Please verify.' });
      }
    }
  });

  // Driver broadcasts updated coordinates
  socket.on('update-location', ({ driverCode, driverToken, lat, lng, speed, stops }) => {
    const upperCode = driverCode.toUpperCase();
    const session = sessions[upperCode];
    
    if (session) {
      // Verify driver token to prevent location spoofing
      if (session.driverToken && session.driverToken !== driverToken) {
        console.warn(`Location spoofing attempt rejected for session ${upperCode}`);
        return;
      }

      console.log(`Location update for ${upperCode}: lat=${lat}, lng=${lng}`);
      const locationData: Location = {
        lat,
        lng,
        speed,
        timestamp: Date.now(),
      };

      session.status = 'active';
      session.lastLocation = locationData;
      session.driverSocketId = socket.id;
      if (stops) {
        session.stops = stops;
      }
      
      if ((session as any).disconnectTimeoutId) {
        clearTimeout((session as any).disconnectTimeoutId);
        (session as any).disconnectTimeoutId = undefined;
        console.log(`Driver updated location for session ${upperCode}. Grace period canceled.`);
      }

      // Broadcast the updated telemetry to students listening in the room
      socket.to(upperCode).emit('location-updated', {
        driverCode: upperCode,
        location: locationData,
        stops: session.stops || stops,
      });
    }
  });

  // Driver stops the ride
  socket.on('stop-session', ({ driverCode, driverToken }) => {
    const upperCode = driverCode.toUpperCase();
    const session = sessions[upperCode];
    
    if (session) {
      if (session.driverToken && session.driverToken !== driverToken) {
        return;
      }
      session.status = 'inactive';
      session.driverSocketId = undefined;
    }
    
    // Broadcast end of ride
    socket.to(upperCode).emit('session-stopped', { driverCode: upperCode });
  });

  // Handle sudden disconnections (e.g. signal drops or tab closes)
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    for (const code in sessions) {
      const session = sessions[code];
      if (session.driverSocketId === socket.id) {
        console.log(`Driver disconnected abruptly from session ${code}. Waiting 35s grace period...`);
        
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
}, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`VanOla Server running on port ${PORT}`);
});

