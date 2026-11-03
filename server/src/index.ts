import 'dotenv/config';
import { createApp } from './app';
import { getConfig } from './config';

const { PORT } = getConfig();
createApp().listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
