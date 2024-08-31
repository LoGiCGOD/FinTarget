import cluster from 'cluster';
import os from 'os';
import dotenv from 'dotenv';
import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import Bull from 'bull';
// import Redis from 'ioredis';
// import moment from 'moment';

dotenv.config();

if (cluster.isPrimary) {
    for (let i = 0; i < 2; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Forking a new worker...`);
        cluster.fork();
    });
} else {
    const app = express();
    app.use(bodyParser.json());

    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT;

    const taskQueue = new Bull('task-queue', {
        redis: {
            host: redisHost,
            port: redisPort
        }
    });

    const userTaskTracker = new Map();

    const taskRateLimiter = rateLimit({
        windowMs: 60000,
        max: 20,
        keyGenerator: (req) => req.body.user_id,
        handler: (req, res) => {
            const user_id = req.body.user_id;
            if (user_id) {
                if (!userTaskTracker.has(user_id)) {
                    userTaskTracker.set(user_id, []);
                }
                userTaskTracker.get(user_id).push(req.body);
                console.log("userTaskTracker after 20 requests:", userTaskTracker);
            }
            res.status(202).json({ message: 'Rate limit exceeded, request queued' });
        }
    });

    const task = async (user_id) => {
        const logMessage = `${user_id}-task completed at-${Date.now()}\n`;
        console.log(logMessage);
        const logFilePath = process.env.LOG_FILE_PATH || path.join(__dirname, 'task.log');
        fs.appendFile(logFilePath, logMessage, (err) => {
            if (err) {
                console.error('Failed to write to log file', err);
            }
        });
    };

    app.post('/task', taskRateLimiter, (req, res) => {
        const { user_id } = req.body;
        if (!user_id) {
            return res.status(400).json({ error: 'user_id is required' });
        }
        taskQueue.add({ user_id });
        res.status(202).json({ message: 'Task accepted' });
    });

    taskQueue.process(async (job, done) => {
        const { user_id } = job.data;
        try {
            await task(user_id);

            const queuedTasks = userTaskTracker.get(user_id) || [];
            console.log('Processing queued tasks for user:', user_id, queuedTasks);
            if (queuedTasks.length > 0) {
                userTaskTracker.set(user_id, []);
                console.log('ifblock queuetasks:', queuedTasks);
                for (const taskData of queuedTasks) {
                    taskQueue.add(taskData);
                }
            }
            done();
        } catch (err) {
            console.error(`Failed to process job ${job.id}:`, err);
            done(err);
        }
    });

    taskQueue.on('failed', (job, err) => {
        console.log(`Job ${job.id} failed with error: ${err.message}`);
        if (job.attemptsMade < 3) {
            console.log(`Retrying job ${job.id} (attempt ${job.attemptsMade + 1})`);
            job.retry();
        } else {
            console.log(`Job ${job.id} has failed after 3 attempts`);
        }
    });

    setInterval(() => {
        for (const [user_id, queuedTasks] of userTaskTracker.entries()) {
            if (queuedTasks.length > 0) {
                console.log(`Processing interval-triggered tasks for user ${user_id}:`, queuedTasks);
                for (const taskData of queuedTasks) {
                    taskQueue.add(taskData);
                }
                userTaskTracker.set(user_id, []);
            }
        }
    }, 1000);

    const PORT = process.env.PORT;
    app.listen(PORT, () => {
        console.log(`Worker ${process.pid} is running on port ${PORT}`);
    });
}
