const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = 'your_jwt_secret_key';
let users = []; // Changed to let for modification
const messages = [];
const privateMessages = {};

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error'));
    socket.username = decoded.username;
    next();
  });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.username);

  // Remove any existing connection for this user
  users = users.filter(user => user.username !== socket.username);
  
  // Add new user to list
  const user = {
    id: socket.id,
    username: socket.username,
    online: true
  };
  users.push(user);

  // Send initial data
  socket.emit('initialMessages', messages);
  io.emit('userList', users);

  // Handle group messages
  socket.on('chatMessage', (msg) => {
    const message = {
      user: socket.username,
      text: msg.text,
      timestamp: msg.timestamp || new Date().toLocaleTimeString()
    };
    messages.push(message);
    io.emit('message', message);
  });

  // Handle private messages
  socket.on('privateMessage', ({ to, message }) => {
    console.log(`Private message attempt from ${socket.username} to ${to}`);
    
    const recipient = users.find(u => u.username === to && u.id !== socket.id);
    if (!recipient) {
      console.log('Recipient not found:', to);
      socket.emit('error', 'User not found or offline');
      return;
    }

    const privateMsg = {
      user: socket.username,
      text: message.text,
      timestamp: message.timestamp || new Date().toLocaleTimeString(),
      isPrivate: true
    };

    // Initialize message storage if needed
    if (!privateMessages[socket.username]) privateMessages[socket.username] = {};
    if (!privateMessages[to]) privateMessages[to] = {};

    if (!privateMessages[to][socket.username]) privateMessages[to][socket.username] = [];
    if (!privateMessages[socket.username][to]) privateMessages[socket.username][to] = [];

    // Add message to both users' histories
    privateMessages[to][socket.username].push(privateMsg);
    privateMessages[socket.username][to].push(privateMsg);

    console.log(`Sending private message to ${recipient.username} (${recipient.id})`);
    
    // Send to recipient
    io.to(recipient.id).emit('privateMessage', {
      from: socket.username,
      message: privateMsg
    });

    // Send to sender (for their own UI)
    socket.emit('privateMessage', {
      from: to,
      message: privateMsg
    });
  });

  // Handle private history requests
  socket.on('getPrivateHistory', ({ withUser }) => {
    const history = privateMessages[socket.username]?.[withUser] || [];
    socket.emit('privateHistory', {
      withUser,
      messages: history
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.username);
    const userIndex = users.findIndex(u => u.id === socket.id);
    if (userIndex !== -1) {
      users[userIndex].online = false;
      io.emit('userList', users);
    }
  });
});

// Simple login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Simple register endpoint
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});