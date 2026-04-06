import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'VanOla backend operational' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
