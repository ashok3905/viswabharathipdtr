const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = 'schoolData.json';

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images, PDFs, and documents are allowed'));
        }
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));
app.use('/uploads', express.static('uploads'));

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

function setNoCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
}

function isValidAttendanceDate(month, year) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    if (year < currentYear - 1 || year > currentYear + 1) {
        return false;
    }
    if (year === currentYear && month > currentMonth) {
        return false;
    }
    return true;
}

function isValidRollNumber(rollNumber) {
    return /^\d{1,2}$/.test(rollNumber) && parseInt(rollNumber) >= 1 && parseInt(rollNumber) <= 60;
}

function parseStudentCode(studentCode) {
    const nurseryMatch = studentCode.match(/^CB25N(\d{3})$/i);
    if (nurseryMatch) {
        return {
            classCode: 'nursery',
            rollNumber: parseInt(nurseryMatch[1]).toString(),
            fullCode: studentCode.toUpperCase(),
            type: 'nursery'
        };
    }
    const lkgMatch = studentCode.match(/^CB25L(\d{3})$/i);
    if (lkgMatch) {
        return {
            classCode: 'lkg',
            rollNumber: parseInt(lkgMatch[1]).toString(),
            fullCode: studentCode.toUpperCase(),
            type: 'lkg'
        };
    }
    const ukgMatch = studentCode.match(/^CB25U(\d{3})$/i);
    if (ukgMatch) {
        return {
            classCode: 'ukg',
            rollNumber: parseInt(ukgMatch[1]).toString(),
            fullCode: studentCode.toUpperCase(),
            type: 'ukg'
        };
    }
    const classMatch = studentCode.match(/^CB25-(0[1-9]|10)-([1-9]|[1-5][0-9]|60)$/i);
    if (classMatch) {
        return {
            classCode: parseInt(classMatch[1]).toString(),
            rollNumber: classMatch[2],
            fullCode: studentCode.toUpperCase(),
            type: 'class'
        };
    }
    return null;
}

// Replace generateStudentCode() in server.js (around line 80)

function generateStudentCode(studentClass, studentRoll) {
    const classStr = studentClass.toString().toLowerCase();
    const rollNum = parseInt(studentRoll);
    
    // Nursery
    if (classStr === 'nursery' && rollNum >= 1 && rollNum <= 999) {
        return `CB25N${rollNum.toString().padStart(3, '0')}`;
    }
    
    // LKG
    if (classStr === 'lkg' && rollNum >= 1 && rollNum <= 999) {
        return `CB25L${rollNum.toString().padStart(3, '0')}`;
    }
    
    // UKG
    if (classStr === 'ukg' && rollNum >= 1 && rollNum <= 999) {
        return `CB25U${rollNum.toString().padStart(3, '0')}`;
    }
    
    // Classes 1-10 - CHANGED FROM 60 TO 999
    const classNum = parseInt(studentClass);
    if (classNum >= 1 && classNum <= 10 && rollNum >= 1 && rollNum <= 999) {
        const formattedClass = classNum.toString().padStart(2, '0');
        return `CB25-${formattedClass}-${rollNum}`;
    }
    
    return null;
}

function isValidClassCode(classCode) {
    const validClasses = ['nursery', 'lkg', 'ukg', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    return validClasses.includes(classCode.toLowerCase());
}

async function ensureUploadsDir() {
    try {
        await fs.access('uploads');
        console.log('✅ Uploads directory exists');
    } catch (error) {
        await fs.mkdir('uploads', { recursive: true });
        console.log('✅ Uploads directory created');
    }
}

async function initializeData() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ Data file exists');
        const data = await readData();
        let updated = false;
        if (data.notifications && typeof data.notifications === 'object' && !Array.isArray(data.notifications)) {
            console.log('🔄 Migrating old notification structure to new array format...');
            const oldNotifications = data.notifications;
            data.notifications = [];
            if (oldNotifications.admin && Array.isArray(oldNotifications.admin)) {
                data.notifications.push(...oldNotifications.admin);
                console.log(`✅ Migrated ${oldNotifications.admin.length} admin notifications`);
            }
            if (oldNotifications.faculty && Array.isArray(oldNotifications.faculty)) {
                data.notifications.push(...oldNotifications.faculty);
                console.log(`✅ Migrated ${oldNotifications.faculty.length} faculty notifications`);
            }
            updated = true;
        }
        if (!data.studentMasterRecords) {
            data.studentMasterRecords = {};
            updated = true;
            console.log('✅ Added studentMasterRecords field');
        }
        if (data.receptionistFeeCertificates && !data.feeCertificates) {
            data.feeCertificates = data.receptionistFeeCertificates;
            delete data.receptionistFeeCertificates;
            updated = true;
            console.log('✅ Renamed receptionistFeeCertificates to feeCertificates');
        }
        if (!data.feeCertificates) {
            data.feeCertificates = [];
            updated = true;
        }
        if (!data.studentFeeCertificates) {
            data.studentFeeCertificates = {};
            updated = true;
        }
        if (!data.hallTickets) {
            data.hallTickets = [];
            updated = true;
        }
        if (!data.studentHallTickets) {
            data.studentHallTickets = {};
            updated = true;
        }
        if (!data.notifications || !Array.isArray(data.notifications)) {
            data.notifications = [];
            updated = true;
        }
        if (updated) {
            await writeData(data);
            console.log('✅ Data structure updated successfully');
        }
    } catch (error) {
        const initialData = {
            facultyPosts: {},
            assignments: {},
            assignmentResults: {},
            progressCards: {},
            monthlyAttendance: [],
            studentMasterRecords: {},
            feeCertificates: [],
            studentFeeCertificates: {},
            hallTickets: [],
            studentHallTickets: {},
            notifications: [],
            history: {
                admin: [],
                faculty: {},
                receptionist: []
            }
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ Created initial data file');
    }
}

async function readData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        if (!parsedData.facultyPosts) parsedData.facultyPosts = {};
        if (!parsedData.assignments) parsedData.assignments = {};
        if (!parsedData.assignmentResults) parsedData.assignmentResults = {};
        if (!parsedData.progressCards) parsedData.progressCards = {};
        if (!parsedData.monthlyAttendance) parsedData.monthlyAttendance = [];
        if (!parsedData.studentMasterRecords) parsedData.studentMasterRecords = {};
        if (!parsedData.feeCertificates) parsedData.feeCertificates = [];
        if (!parsedData.studentFeeCertificates) parsedData.studentFeeCertificates = {};
        if (!parsedData.hallTickets) parsedData.hallTickets = [];
        if (!parsedData.studentHallTickets) parsedData.studentHallTickets = {};
        if (parsedData.receptionistFeeCertificates && !parsedData.feeCertificates) {
            parsedData.feeCertificates = parsedData.receptionistFeeCertificates;
            delete parsedData.receptionistFeeCertificates;
        }
        if (!parsedData.notifications || typeof parsedData.notifications !== 'object') {
            parsedData.notifications = [];
        } else if (!Array.isArray(parsedData.notifications)) {
            const oldNotifications = parsedData.notifications;
            parsedData.notifications = [];
            if (oldNotifications.admin && Array.isArray(oldNotifications.admin)) {
                parsedData.notifications.push(...oldNotifications.admin);
            }
            if (oldNotifications.faculty && Array.isArray(oldNotifications.faculty)) {
                parsedData.notifications.push(...oldNotifications.faculty);
            }
        }
        if (!parsedData.history) parsedData.history = { admin: [], faculty: {}, receptionist: [] };
        if (!parsedData.history.receptionist) parsedData.history.receptionist = [];
        return parsedData;
    } catch (error) {
        console.error('❌ Error reading data:', error);
        return { 
            facultyPosts: {},
            assignments: {},
            assignmentResults: {},
            progressCards: {},
            monthlyAttendance: [],
            studentMasterRecords: {},
            feeCertificates: [],
            studentFeeCertificates: {},
            hallTickets: [],
            studentHallTickets: {},
            notifications: [],
            history: {
                admin: [],
                faculty: {},
                receptionist: []
            }
        };
    }
}

async function writeData(data) {
    try {
        try {
            const backupFile = DATA_FILE + '.backup';
            const currentData = await fs.readFile(DATA_FILE, 'utf8');
            await fs.writeFile(backupFile, currentData);
        } catch (backupError) {
            console.log('⚠️ Could not create backup:', backupError.message);
        }
        if (!data.facultyPosts) data.facultyPosts = {};
        if (!data.assignments) data.assignments = {};
        if (!data.assignmentResults) data.assignmentResults = {};
        if (!data.progressCards) data.progressCards = {};
        if (!data.monthlyAttendance) data.monthlyAttendance = [];
        if (!data.studentMasterRecords) data.studentMasterRecords = {};
        if (!data.feeCertificates) data.feeCertificates = [];
        if (!data.studentFeeCertificates) data.studentFeeCertificates = {};
        if (!data.hallTickets) data.hallTickets = [];
        if (!data.studentHallTickets) data.studentHallTickets = {};
        if (!Array.isArray(data.notifications)) {
            data.notifications = [];
        }
        if (!data.history) data.history = { admin: [], faculty: {}, receptionist: [] };
        if (!data.history.receptionist) data.history.receptionist = [];
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Data written successfully');
        return true;
    } catch (error) {
        console.error('❌ Error writing data:', error);
        return false;
    }
}

function cleanExpiredPosts(data) {
    const now = new Date();
    if (data.facultyPosts) {
        Object.keys(data.facultyPosts).forEach(classCode => {
            Object.keys(data.facultyPosts[classCode]).forEach(type => {
                data.facultyPosts[classCode][type] = data.facultyPosts[classCode][type].filter(post => {
                    if (!post.expiryDate) return true;
                    return new Date(post.expiryDate) > now;
                });
            });
        });
    }
    if (data.assignments) {
        Object.keys(data.assignments).forEach(classCode => {
            data.assignments[classCode] = data.assignments[classCode].filter(assignment => {
                if (!assignment.expiryDate) return true;
                return new Date(assignment.expiryDate) > now;
            });
        });
    }
    if (data.progressCards) {
        Object.keys(data.progressCards).forEach(classCode => {
            data.progressCards[classCode] = data.progressCards[classCode].filter(card => {
                if (!card.expiryDate) return true;
                return new Date(card.expiryDate) > now;
            });
        });
    }
    if (Array.isArray(data.notifications)) {
        data.notifications = data.notifications.filter(notif => {
            if (!notif.expiryDate) return true;
            return new Date(notif.expiryDate) > now;
        });
    }
    return data;
}

function addToHistory(data, type, userCode, post) {
    if (!data.history) {
        data.history = { admin: [], faculty: {}, receptionist: [] };
    }
    const historyPost = {
        ...post,
        type: type,
        originalDate: post.date || post.postedAt
    };
    if (userCode === 'admin') {
        if (!data.history.admin) data.history.admin = [];
        data.history.admin.push(historyPost);
    } else if (userCode === 'receptionist') {
        if (!data.history.receptionist) data.history.receptionist = [];
        data.history.receptionist.push(historyPost);
    } else {
        if (!data.history.faculty) data.history.faculty = {};
        if (!data.history.faculty[userCode]) {
            data.history.faculty[userCode] = [];
        }
        data.history.faculty[userCode].push(historyPost);
    }
}

app.post('/api/admin/notifications', upload.single('file'), async (req, res) => {
    try {
        console.log('📩 Notification request received');
        console.log('Body:', req.body);
        console.log('File:', req.file);
        let { title, message, type, targetAudience, targetClass, displayDays, priority } = req.body;
        title = sanitizeInput(title);
        message = sanitizeInput(message);
        type = sanitizeInput(type) || 'general';
        targetAudience = sanitizeInput(targetAudience) || 'all';
        targetClass = sanitizeInput(targetClass) || 'all';
        priority = sanitizeInput(priority) || 'normal';
        if (!title || !message) {
            return res.status(400).json({ 
                success: false,
                error: 'Title and message are required' 
            });
        }
        if (title.length > 200 || message.length > 1000) {
            return res.status(400).json({ 
                success: false,
                error: 'Title or message too long' 
            });
        }
        const parsedDisplayDays = parseInt(displayDays);
        if (!displayDays || isNaN(parsedDisplayDays) || parsedDisplayDays < 1 || parsedDisplayDays > 365) {
            return res.status(400).json({ 
                success: false,
                error: 'Display days must be between 1 and 365' 
            });
        }
        const data = await readData();
        if (!Array.isArray(data.notifications)) {
            data.notifications = [];
        }
        const now = new Date();
        const expiryDate = new Date(now.getTime() + (parsedDisplayDays * 24 * 60 * 60 * 1000));
        const notification = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            source: 'admin',
            title: title,
            message: message,
            type: type,
            priority: priority,
            targetAudience: targetAudience,
            targetClass: targetClass,
            createdAt: now.toISOString(),
            expiryDate: expiryDate.toISOString(),
            displayDays: parsedDisplayDays,
            readBy: [],
            file: req.file ? `/uploads/${req.file.filename}` : null,
            fileName: req.file ? req.file.originalname : null
        };
        data.notifications.push(notification);
        addToHistory(data, 'notification-sent', 'admin', {
            text: `Notification sent: ${notification.title} to ${targetAudience}`,
            date: notification.createdAt
        });
        if (await writeData(data)) {
            console.log('✅ Notification created:', notification.id);
            res.json({ success: true, notification: notification });
        } else {
            res.status(500).json({ 
                success: false,
                error: 'Failed to save notification' 
            });
        }
    } catch (error) {
        console.error('❌ Error creating notification:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false,
                error: 'Internal server error: ' + error.message 
            });
        }
    }
});

app.get('/api/admin/notifications', async (req, res) => {
    try {
        setNoCacheHeaders(res); 
        let data = await readData();
        data = cleanExpiredPosts(data);
        await writeData(data);
        if (!Array.isArray(data.notifications)) {
            return res.json([]);
        }
        const adminNotifications = data.notifications
            .filter(notif => notif.source === 'admin')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(adminNotifications);
    } catch (error) {
        console.error('❌ Error fetching admin notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/notifications/:notificationId', async (req, res) => {
    try {
        const { notificationId } = req.params;
        const sanitizedNotificationId = sanitizeInput(notificationId);
        if (!sanitizedNotificationId) {
            return res.status(400).json({ error: 'Notification ID is required' });
        }
        const data = await readData();
        if (!Array.isArray(data.notifications)) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        const initialLength = data.notifications.length;
        data.notifications = data.notifications.filter(n => 
            !(n.id === sanitizedNotificationId && n.source === 'admin')
        );
        if (data.notifications.length === initialLength) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        addToHistory(data, 'notification-deleted', 'admin', {
            text: `Notification deleted: ${sanitizedNotificationId}`,
            date: new Date().toISOString()
        });
        if (await writeData(data)) {
            res.json({ success: true, message: 'Notification deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete notification' });
        }
    } catch (error) {
        console.error('❌ Error deleting notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/delete-all-notifications', async (req, res) => {
    try {
        const data = await readData();
        if (!Array.isArray(data.notifications)) {
            return res.json({ success: true, message: 'No notifications to delete', deletedCount: 0 });
        }
        const adminNotifications = data.notifications.filter(n => n.source === 'admin');
        const deletedCount = adminNotifications.length;
        data.notifications = data.notifications.filter(n => n.source !== 'admin');
        addToHistory(data, 'all-notifications-deleted', 'admin', {
            text: `All notifications deleted (${deletedCount} notifications)`,
            date: new Date().toISOString()
        });
        if (await writeData(data)) {
            console.log(`✅ All ${deletedCount} admin notifications deleted`);
            res.json({ 
                success: true, 
                message: 'All notifications deleted successfully',
                deletedCount: deletedCount
            });
        } else {
            res.status(500).json({ error: 'Failed to delete notifications' });
        }
    } catch (error) {
        console.error('❌ Error deleting all notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/faculty/:facultyCode/notifications', async (req, res) => {
    try {
        const { facultyCode } = req.params;
        const sanitizedFacultyCode = sanitizeInput(facultyCode);
        if (!sanitizedFacultyCode) {
            return res.status(400).json({ error: 'Faculty code is required' });
        }
        let data = await readData();
        data = cleanExpiredPosts(data);
        await writeData(data);
        if (!Array.isArray(data.notifications)) {
            return res.json([]);
        }
        const facultyNotifications = data.notifications.filter(notif => {
            if (notif.targetAudience === 'all' || notif.targetAudience === 'faculty') {
                return true;
            }
            return false;
        });
        const notificationsWithReadStatus = facultyNotifications.map(notif => ({
            ...notif,
            isRead: notif.readBy && notif.readBy.includes(sanitizedFacultyCode)
        }));
        notificationsWithReadStatus.sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        res.json(notificationsWithReadStatus);
    } catch (error) {
        console.error('❌ Error fetching faculty notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/student/notifications/:studentCode', async (req, res) => {
    try {
        const { studentCode } = req.params;
        const sanitizedStudentCode = sanitizeInput(studentCode);
        if (!sanitizedStudentCode) {
            return res.status(400).json({ error: 'Student code is required' });
        }
        let data = await readData();
        data = cleanExpiredPosts(data);
        await writeData(data);
        const parsedCode = parseStudentCode(sanitizedStudentCode);
        if (!parsedCode) {
            return res.status(400).json({ error: 'Invalid student code format' });
        }
        const studentClass = parsedCode.classCode;
        if (!Array.isArray(data.notifications)) {
            return res.json([]);
        }
        const studentNotifications = data.notifications.filter(notif => {
            if (notif.targetAudience === 'all' || notif.targetAudience === 'students') {
                if (notif.targetClass === 'all' || notif.targetClass === studentClass) {
                    return true;
                }
            }
            return false;
        });
        const notificationsWithReadStatus = studentNotifications.map(notif => ({
            ...notif,
            isRead: notif.readBy && notif.readBy.includes(sanitizedStudentCode)
        }));
        notificationsWithReadStatus.sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        res.json(notificationsWithReadStatus);
    } catch (error) {
        console.error('❌ Error fetching student notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/notifications/:notificationId/read', async (req, res) => {
    try {
        const { notificationId } = req.params;
        const { userCode } = req.body;
        const sanitizedNotificationId = sanitizeInput(notificationId);
        const sanitizedUserCode = sanitizeInput(userCode);
        if (!sanitizedNotificationId || !sanitizedUserCode) {
            return res.status(400).json({ error: 'Notification ID and user code are required' });
        }
        const data = await readData();
        if (!Array.isArray(data.notifications)) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        const notification = data.notifications.find(n => n.id === sanitizedNotificationId);
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        if (!notification.readBy) {
            notification.readBy = [];
        }
        if (!notification.readBy.includes(sanitizedUserCode)) {
            notification.readBy.push(sanitizedUserCode);
        }
        if (await writeData(data)) {
            res.json({ success: true, message: 'Notification marked as read' });
        } else {
            res.status(500).json({ error: 'Failed to update notification' });
        }
    } catch (error) {
        console.error('❌ Error marking notification as read:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/notifications/read-all', async (req, res) => {
    try {
        const { userCode, userType } = req.body;
        const sanitizedUserCode = sanitizeInput(userCode);
        const sanitizedUserType = sanitizeInput(userType);
        if (!sanitizedUserCode || !sanitizedUserType) {
            return res.status(400).json({ error: 'User code and user type are required' });
        }
        const data = await readData();
        let markedCount = 0;
        if (!Array.isArray(data.notifications)) {
            return res.json({ success: true, message: '0 notifications marked as read' });
        }
        data.notifications.forEach(notif => {
            if (!notif.readBy) {
                notif.readBy = [];
            }
            if (!notif.readBy.includes(sanitizedUserCode)) {
                notif.readBy.push(sanitizedUserCode);
                markedCount++;
            }
        });
        if (await writeData(data)) {
            res.json({ success: true, message: `${markedCount} notifications marked as read` });
        } else {
            res.status(500).json({ error: 'Failed to update notifications' });
        }
    } catch (error) {
        console.error('❌ Error marking all notifications as read:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/data', async (req, res) => {
    setNoCacheHeaders(res);
    let data = await readData();
    data = cleanExpiredPosts(data);
    await writeData(data);
    const responseData = {
        ...data,
        feeCertificates: data.feeCertificates || []
    };
    res.json(responseData);
});

app.get('/api/history/:userType/:userCode?', async (req, res) => {
    const { userType, userCode } = req.params;
    const data = await readData();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let history = [];
    if (userType === 'admin') {
        history = data.history?.admin || [];
    } else if (userType === 'receptionist') {
        history = data.history?.receptionist || [];
    } else if (userType === 'faculty' && userCode) {
        history = data.history?.faculty?.[userCode] || [];
    }
    const recentHistory = history.filter(post => {
        try {
            const postDate = new Date(post.date || post.originalDate || post.postedAt);
            return postDate >= thirtyDaysAgo;
        } catch (error) {
            return false;
        }
    });
    res.json(recentHistory);
});

app.post('/api/faculty-posts', upload.single('file'), async (req, res) => {
    try {
        let { classCode, type, text, facultyCode, displayDays } = req.body;
        classCode = sanitizeInput(classCode);
        type = sanitizeInput(type);
        text = sanitizeInput(text);
        facultyCode = sanitizeInput(facultyCode);
        if (!classCode || !type || !text || !facultyCode) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (!isValidClassCode(classCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        if (!['homework', 'assignment', 'subject'].includes(type)) {
            return res.status(400).json({ error: 'Invalid post type' });
        }
        if (text.length > 1000) {
            return res.status(400).json({ error: 'Text must be less than 1000 characters' });
        }
        const data = await readData();
        const now = new Date();
        const expiryDate = displayDays ? new Date(now.getTime() + (parseInt(displayDays) * 24 * 60 * 60 * 1000)) : null;
        const newPost = {
            id: Date.now(),
            text: text,
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            faculty: facultyCode,
            file: req.file ? `/uploads/${req.file.filename}` : null,
            fileName: req.file ? req.file.originalname : null,
            expiryDate: expiryDate
        };
        if (!data.facultyPosts[classCode]) {
            data.facultyPosts[classCode] = {
                homework: [],
                assignment: [],
                subject: []
            };
        }
        if (!data.facultyPosts[classCode][type]) {
            data.facultyPosts[classCode][type] = [];
        }
        data.facultyPosts[classCode][type].push(newPost);
        addToHistory(data, `faculty-${type}`, facultyCode, newPost);
        if (await writeData(data)) {
            console.log(`Faculty post (${type}) for class ${classCode}:`, newPost);
            res.json({ success: true, post: newPost });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    } catch (error) {
        console.error('Error posting faculty message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/create-assignment', async (req, res) => {
    try {
        let { classCode, facultyCode, title, assignmentDate, questions, displayDays } = req.body;
        classCode = sanitizeInput(classCode);
        facultyCode = sanitizeInput(facultyCode);
        title = sanitizeInput(title);
        if (!classCode || !facultyCode || !title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        assignmentDate = sanitizeInput(assignmentDate);
        if (!assignmentDate) {
            return res.status(400).json({ error: 'Assignment date is required' });
        }
        if (!isValidClassCode(classCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        if (title.length > 200) {
            return res.status(400).json({ error: 'Title must be less than 200 characters' });
        }
        if (questions.length > 20) {
            return res.status(400).json({ error: 'Maximum 20 questions allowed' });
        }
        const sanitizedQuestions = questions.map((q, index) => {
            if (!q.question || !q.options || !q.correctAnswer) {
                throw new Error(`Question ${index + 1} is incomplete`);
            }
            const sanitizedQuestion = sanitizeInput(q.question);
            if (sanitizedQuestion.length > 500) {
                throw new Error(`Question ${index + 1} is too long`);
            }
            const sanitizedOptions = {};
            ['a', 'b', 'c', 'd'].forEach(option => {
                if (!q.options[option]) {
                    throw new Error(`Question ${index + 1} is missing option ${option.toUpperCase()}`);
                }
                sanitizedOptions[option] = sanitizeInput(q.options[option]);
                if (sanitizedOptions[option].length > 200) {
                    throw new Error(`Question ${index + 1} option ${option.toUpperCase()} is too long`);
                }
            });
            if (!['a', 'b', 'c', 'd'].includes(q.correctAnswer)) {
                throw new Error(`Question ${index + 1} has invalid correct answer`);
            }
            return {
                question: sanitizedQuestion,
                options: sanitizedOptions,
                correctAnswer: q.correctAnswer
            };
        });
        const data = await readData();
        const now = new Date();
        const expiryDate = displayDays ? new Date(now.getTime() + (parseInt(displayDays) * 24 * 60 * 60 * 1000)) : null;
        const assignmentId = Date.now();
        const newAssignment = {
            id: assignmentId,
            title: title,
            classCode: classCode,
            facultyCode: facultyCode,
            assignmentDate: assignmentDate,
            questions: sanitizedQuestions,
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            expiryDate: expiryDate,
            isActive: true
        };
        if (!data.assignments[classCode]) {
            data.assignments[classCode] = [];
        }
        data.assignments[classCode].push(newAssignment);
        addToHistory(data, 'assignment-created', facultyCode, {
            title: newAssignment.title,
            text: `Assignment created: ${newAssignment.title} for Class ${classCode}`,
            date: newAssignment.date
        });
        if (await writeData(data)) {
            console.log('Assignment created:', newAssignment);
            res.json({ success: true, assignment: newAssignment });
        } else {
            res.status(500).json({ error: 'Failed to save assignment' });
        }
    } catch (error) {
        console.error('Error creating assignment:', error);
        res.status(400).json({ error: error.message || 'Internal server error' });
    }
});

app.delete('/api/delete-assignment/:assignmentId', async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { facultyCode } = req.body;
        if (!assignmentId || !facultyCode) {
            return res.status(400).json({ error: 'Assignment ID and faculty code are required' });
        }
        const data = await readData();
        let assignmentFound = false;
        let assignmentDeleted = false;
        if (data.assignments) {
            Object.keys(data.assignments).forEach(classCode => {
                const classAssignments = data.assignments[classCode] || [];
                const assignmentIndex = classAssignments.findIndex(assignment => 
                    assignment.id == assignmentId && assignment.facultyCode === facultyCode
                );
                if (assignmentIndex >= 0) {
                    assignmentFound = true;
                    const deletedAssignment = classAssignments.splice(assignmentIndex, 1)[0];
                    assignmentDeleted = true;
                    if (data.assignmentResults && data.assignmentResults[assignmentId]) {
                        delete data.assignmentResults[assignmentId];
                    }
                    addToHistory(data, 'assignment-deleted', facultyCode, {
                        text: `Assignment deleted: ${deletedAssignment.title} for Class ${classCode}`,
                        date: new Date().toISOString()
                    });
                }
            });
        }
        if (!assignmentFound) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        if (assignmentDeleted && await writeData(data)) {
            console.log(`Assignment ${assignmentId} deleted`);
            res.json({ success: true, message: 'Assignment deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete assignment' });
        }
    } catch (error) {
        console.error('Error deleting assignment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/submit-assignment', async (req, res) => {
    try {
        let { assignmentId, classCode, studentCode, answers } = req.body;
        assignmentId = sanitizeInput(assignmentId);
        classCode = sanitizeInput(classCode);
        studentCode = sanitizeInput(studentCode);
        if (!assignmentId || !classCode || !studentCode || !answers) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (!Array.isArray(answers)) {
            return res.status(400).json({ error: 'Answers must be an array' });
        }
        if (!isValidClassCode(classCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        const parsedCode = parseStudentCode(studentCode);
        if (!parsedCode) {
            return res.status(400).json({ error: 'Invalid student code format' });
        }
        if (parsedCode.classCode !== classCode) {
            return res.status(400).json({ error: 'Student does not belong to this class' });
        }
        const data = await readData();
        const assignments = data.assignments[classCode] || [];
        const assignment = assignments.find(a => a.id == assignmentId);
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        if (!assignment.isActive) {
            return res.status(400).json({ error: 'Assignment is no longer active' });
        }
        if (answers.length !== assignment.questions.length) {
            return res.status(400).json({ error: 'Number of answers must match number of questions' });
        }
        const validAnswers = answers.map((answer, index) => {
            if (!['a', 'b', 'c', 'd'].includes(answer)) {
                throw new Error(`Invalid answer for question ${index + 1}`);
            }
            return answer;
        });
        let score = 0;
        const results = assignment.questions.map((question, index) => {
            const studentAnswer = validAnswers[index];
            const isCorrect = studentAnswer === question.correctAnswer;
            if (isCorrect) score++;
            return {
                question: question.question,
                options: question.options,
                studentAnswer: studentAnswer,
                correctAnswer: question.correctAnswer,
                isCorrect: isCorrect
            };
        });
        const submission = {
            assignmentId: assignmentId,
            studentCode: studentCode.toUpperCase(),
            classCode: classCode,
            score: score,
            totalQuestions: assignment.questions.length,
            percentage: Math.round((score / assignment.questions.length) * 100),
            results: results,
            submittedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        };
        if (!data.assignmentResults[assignmentId]) {
            data.assignmentResults[assignmentId] = [];
        }
        const existingIndex = data.assignmentResults[assignmentId].findIndex(r => r.studentCode === studentCode.toUpperCase());
        if (existingIndex >= 0) {
            data.assignmentResults[assignmentId][existingIndex] = submission;
        } else {
            data.assignmentResults[assignmentId].push(submission);
        }
        if (await writeData(data)) {
            console.log('Assignment submitted:', submission);
            res.json({ success: true, submission: submission });
        } else {
            res.status(500).json({ error: 'Failed to save submission' });
        }
    } catch (error) {
        console.error('Error submitting assignment:', error);
        res.status(400).json({ error: error.message || 'Internal server error' });
    }
});

app.post('/api/create-progress-card', async (req, res) => {
    try {
        let { classCode, facultyCode, rollNumber, fullName, fatherName, examType, subjects, totalMarks, obtainedMarks, percentage, performance, postingDate, displayDays, expiryDate } = req.body;
        classCode = sanitizeInput(classCode);
        facultyCode = sanitizeInput(facultyCode);
        rollNumber = sanitizeInput(rollNumber);
        fullName = sanitizeInput(fullName);
        fatherName = sanitizeInput(fatherName);
        examType = sanitizeInput(examType);
        if (!classCode || !facultyCode || !rollNumber || !fullName || !fatherName || !examType || !totalMarks || obtainedMarks === undefined || !postingDate || !displayDays) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }
        if (!isValidClassCode(classCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        const studentCode = generateStudentCode(classCode, rollNumber);
        if (!studentCode) {
            return res.status(400).json({ error: 'Invalid class or roll number combination' });
        }
        const data = await readData();
        const progressCardId = Date.now();
        const newProgressCard = {
            id: progressCardId,
            classCode: classCode,
            facultyCode: facultyCode,
            rollNumber: rollNumber,
            studentCode: studentCode,
            fullName: fullName,
            fatherName: fatherName,
            examType: examType,
            subjects: subjects,
            totalMarks: totalMarks,
            obtainedMarks: obtainedMarks,
            percentage: percentage,
            performance: performance,
            postingDate: postingDate,
            displayDays: displayDays,
            expiryDate: expiryDate,
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        };
        if (!data.progressCards[classCode]) {
            data.progressCards[classCode] = [];
        }
        const existingIndex = data.progressCards[classCode].findIndex(
            card => (card.rollNumber === rollNumber || card.studentCode === studentCode) && card.examType === examType
        );
        if (existingIndex >= 0) {
            data.progressCards[classCode][existingIndex] = newProgressCard;
        } else {
            data.progressCards[classCode].push(newProgressCard);
        }
        addToHistory(data, 'progress-card', facultyCode, {
            text: `Progress card for ${newProgressCard.fullName} (${newProgressCard.studentCode}) - Class ${classCode}`,
            date: newProgressCard.date
        });
        if (await writeData(data)) {
            res.json({ success: true, progressCard: newProgressCard });
        } else {
            res.status(500).json({ error: 'Failed to save progress card' });
        }
    } catch (error) {
        console.error('Error creating progress card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/delete-progress-card/:cardId', async (req, res) => {
    try {
        const { cardId } = req.params;
        const { facultyCode, classCode } = req.body;
        if (!cardId || !facultyCode || !classCode) {
            return res.status(400).json({ error: 'Card ID, faculty code, and class code are required' });
        }
        const data = await readData();
        if (!data.progressCards || !data.progressCards[classCode]) {
            return res.status(404).json({ error: 'No progress cards found' });
        }
        const cardIndex = data.progressCards[classCode].findIndex(card => 
            card.id == cardId && card.facultyCode === facultyCode
        );
        if (cardIndex === -1) {
            return res.status(404).json({ error: 'Progress card not found' });
        }
        const deletedCard = data.progressCards[classCode].splice(cardIndex, 1)[0];
        addToHistory(data, 'progress-card-deleted', facultyCode, {
            text: `Progress card deleted for ${deletedCard.fullName}`,
            date: new Date().toISOString()
        });
        if (await writeData(data)) {
            res.json({ success: true, message: 'Progress card deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete progress card' });
        }
    } catch (error) {
        console.error('Error deleting progress card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/post-monthly-attendance', async (req, res) => {
    try {
        let { classCode, facultyCode, month, year, studentName, studentRoll, totalWorkingDays, attendedDays } = req.body;
        classCode = sanitizeInput(classCode);
        facultyCode = sanitizeInput(facultyCode);
        studentName = sanitizeInput(studentName);
        studentRoll = sanitizeInput(studentRoll);
        if (!classCode || !facultyCode || !month || !year || !studentName || !studentRoll || 
            totalWorkingDays === undefined || attendedDays === undefined) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (!isValidClassCode(classCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        month = parseInt(month);
        year = parseInt(year);
        totalWorkingDays = parseInt(totalWorkingDays);
        attendedDays = parseInt(attendedDays);
        if (isNaN(month) || isNaN(year) || isNaN(totalWorkingDays) || isNaN(attendedDays)) {
            return res.status(400).json({ error: 'Invalid numeric values' });
        }
        if (!isValidAttendanceDate(month, year)) {
            return res.status(400).json({ error: 'Invalid attendance date' });
        }
        const studentCode = generateStudentCode(classCode, studentRoll);
        if (!studentCode) {
            return res.status(400).json({ error: 'Invalid class or roll number combination' });
        }
        const data = await readData();
        if (!data.monthlyAttendance) {
            data.monthlyAttendance = [];
        }
        const percentage = totalWorkingDays > 0 ? Math.round((attendedDays / totalWorkingDays) * 100) : 0;
        const attendanceRecord = {
            id: Date.now() + Math.random(),
            classCode: classCode,
            facultyCode: facultyCode,
            studentCode: studentCode,
            month: month,
            year: year,
            studentName: studentName,
            studentRoll: studentRoll,
            totalWorkingDays: totalWorkingDays,
            attendedDays: attendedDays,
            percentage: percentage,
            postedAt: new Date().toISOString()
        };
        const existingIndex = data.monthlyAttendance.findIndex(
            record => record.studentCode === studentCode && 
                      record.month === month && 
                      record.year === year
        );
        if (existingIndex >= 0) {
            data.monthlyAttendance[existingIndex] = attendanceRecord;
        } else {
            data.monthlyAttendance.push(attendanceRecord);
        }
        addToHistory(data, 'monthly-attendance', facultyCode, {
            text: `Monthly attendance posted for ${studentName} (${studentCode})`,
            date: attendanceRecord.postedAt
        });
        if (await writeData(data)) {
            console.log('Monthly attendance posted:', attendanceRecord);
            res.json({ success: true, record: attendanceRecord });
        } else {
            res.status(500).json({ error: 'Failed to save attendance' });
        }
    } catch (error) {
        console.error('Error posting attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/monthly-attendance/:classCode', async (req, res) => {
    try {
        const { classCode } = req.params;
        const sanitizedClassCode = sanitizeInput(classCode);
        if (!sanitizedClassCode) {
            return res.status(400).json({ error: 'Class code is required' });
        }
        if (!isValidClassCode(sanitizedClassCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        const data = await readData();
        if (!data.monthlyAttendance) data.monthlyAttendance = [];
        const classAttendanceRecords = data.monthlyAttendance.filter(record => 
            record.classCode === sanitizedClassCode
        );
        classAttendanceRecords.sort((a, b) => {
            const dateA = new Date(a.year, a.month - 1);
            const dateB = new Date(b.year, b.month - 1);
            return dateB - dateA;
        });
        res.json(classAttendanceRecords);
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/delete-monthly-attendance/:recordId', async (req, res) => {
    try {
        const { recordId } = req.params;
        const { facultyCode } = req.body;
        if (!recordId || !facultyCode) {
            return res.status(400).json({ error: 'Record ID and faculty code are required' });
        }
        const data = await readData();
        if (!data.monthlyAttendance) {
            return res.status(404).json({ error: 'No attendance records found' });
        }
        const recordIndex = data.monthlyAttendance.findIndex(record => 
            record.id == recordId && record.facultyCode === facultyCode
        );
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Attendance record not found or unauthorized' });
        }
        const deletedRecord = data.monthlyAttendance.splice(recordIndex, 1)[0];
        addToHistory(data, 'attendance-deleted', facultyCode, {
            text: `Monthly attendance deleted for ${deletedRecord.studentName} (${deletedRecord.studentCode})`,
            date: new Date().toISOString()
        });
        if (await writeData(data)) {
            console.log(`Attendance record ${recordId} deleted by ${facultyCode}`);
            res.json({ success: true, message: 'Attendance record deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete attendance record' });
        }
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/progress-cards/:classCode', async (req, res) => {
    try {
        const { classCode } = req.params;
        const sanitizedClassCode = sanitizeInput(classCode);
        if (!sanitizedClassCode) {
            return res.status(400).json({ error: 'Class code is required' });
        }
        if (!isValidClassCode(sanitizedClassCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        const data = await readData();
        if (!data.progressCards) data.progressCards = {};
        if (!data.progressCards[sanitizedClassCode]) data.progressCards[sanitizedClassCode] = [];
        const progressCards = data.progressCards[sanitizedClassCode];
        progressCards.sort((a, b) => parseInt(a.rollNumber) - parseInt(b.rollNumber));
        res.json(progressCards);
    } catch (error) {
        console.error('Error fetching progress cards:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/assignment-results/:assignmentId', async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const sanitizedAssignmentId = sanitizeInput(assignmentId);
        if (!sanitizedAssignmentId) {
            return res.status(400).json({ error: 'Assignment ID is required' });
        }
        const data = await readData();
        const results = data.assignmentResults[sanitizedAssignmentId] || [];
        results.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        res.json(results);
    } catch (error) {
        console.error('Error fetching assignment results:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/assignments/:classCode', async (req, res) => {
    try {
        const { classCode } = req.params;
        const sanitizedClassCode = sanitizeInput(classCode);
        if (!sanitizedClassCode) {
            return res.status(400).json({ error: 'Class code is required' });
        }
        if (!isValidClassCode(sanitizedClassCode)) {
            return res.status(400).json({ error: 'Invalid class code' });
        }
        let data = await readData();
        data = cleanExpiredPosts(data);
        if (!data.assignments) data.assignments = {};
        if (!data.assignments[sanitizedClassCode]) data.assignments[sanitizedClassCode] = [];
        const assignments = data.assignments[sanitizedClassCode];
        const activeAssignments = assignments.filter(a => a.isActive);
        activeAssignments.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(activeAssignments);
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/register-student', async (req, res) => {
    try {
        console.log('📝 Student registration request received');
        console.log('Body:', req.body);
        
        let { studentClass, studentRoll, studentName, fatherName, totalFee, academicYear, registeredBy } = req.body;
        
        studentClass = sanitizeInput(studentClass);
        studentRoll = sanitizeInput(studentRoll);
        studentName = sanitizeInput(studentName);
        fatherName = sanitizeInput(fatherName);
        academicYear = sanitizeInput(academicYear);
        
        // Validate registeredBy
        if (!registeredBy || !['admin', 'receptionist'].includes(registeredBy)) {
            console.error('❌ Invalid registeredBy value:', registeredBy);
            return res.status(403).json({ error: 'Invalid user type for registration' });
        }
        
        if (!studentClass || !studentRoll || !studentName || !fatherName || !academicYear || totalFee === undefined) {
            console.error('❌ Missing required fields');
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        if (!isValidClassCode(studentClass)) {
            console.error('❌ Invalid class code:', studentClass);
            return res.status(400).json({ error: 'Invalid class selected' });
        }
        
        totalFee = parseFloat(totalFee);
        if (isNaN(totalFee) || totalFee < 0) {
            console.error('❌ Invalid fee amount:', totalFee);
            return res.status(400).json({ error: 'Invalid total fee amount' });
        }
        
        const studentCode = generateStudentCode(studentClass, studentRoll);
        if (!studentCode) {
            console.error('❌ Could not generate student code');
            return res.status(400).json({ error: 'Invalid class or roll number combination' });
        }
        
        const data = await readData();
        if (!data.studentMasterRecords) {
            data.studentMasterRecords = {};
        }
        
        const existingStudent = data.studentMasterRecords[studentCode];
        if (existingStudent && existingStudent.academicYear === academicYear) {
            console.log('⚠️ Student already exists:', studentCode);
            return res.status(400).json({ 
                error: `Student ${studentCode} already registered for ${academicYear}`,
                existingRecord: existingStudent
            });
        }
        
        const studentRecord = {
            studentCode: studentCode,
            studentName: studentName,
            fatherName: fatherName,
            studentClass: studentClass,
            studentRoll: studentRoll,
            totalFee: totalFee,
            currentDue: totalFee,
            academicYear: academicYear,
            registeredDate: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        data.studentMasterRecords[studentCode] = studentRecord;
        
        addToHistory(data, 'student-registered', registeredBy, {
            text: `Student registered: ${studentName} (${studentCode}) - Total Fee: ₹${totalFee}`,
            date: studentRecord.registeredDate
        });
        
        if (await writeData(data)) {
            console.log('✅ Student registered:', studentCode);
            res.json({ success: true, studentRecord: studentRecord });
        } else {
            console.error('❌ Failed to write data');
            res.status(500).json({ error: 'Failed to register student' });
        }
    } catch (error) {
        console.error('❌ Error registering student:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Replace the /api/student-balance/:studentCode endpoint in server.js

app.get('/api/student-balance/:studentCode', async (req, res) => {
    try {
        const { studentCode } = req.params;
        const sanitizedStudentCode = sanitizeInput(studentCode);
        
        if (!sanitizedStudentCode) {
            return res.status(400).json({ 
                success: false,
                error: 'Student code is required' 
            });
        }
        
        const data = await readData();
        
        if (!data.studentMasterRecords) {
            return res.status(404).json({ 
                success: false,
                error: 'No student records found in system' 
            });
        }
        
        const upperStudentCode = sanitizedStudentCode.toUpperCase();
        const studentRecord = data.studentMasterRecords[upperStudentCode];
        
        if (!studentRecord) {
            console.log(`❌ Student not found: ${upperStudentCode}`);
            return res.status(404).json({ 
                success: false,
                error: `Student ${upperStudentCode} not found. Please register this student first.`,
                studentCode: upperStudentCode
            });
        }
        
        console.log(`✅ Student found: ${upperStudentCode}`);
        res.json({
            success: true,
            studentCode: studentRecord.studentCode,
            studentName: studentRecord.studentName,
            fatherName: studentRecord.fatherName,
            studentClass: studentRecord.studentClass,
            studentRoll: studentRecord.studentRoll,
            totalFee: studentRecord.totalFee,
            currentDue: studentRecord.currentDue,
            academicYear: studentRecord.academicYear,
            lastUpdated: studentRecord.lastUpdated
        });
    } catch (error) {
        console.error('❌ Error fetching student balance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error: ' + error.message 
        });
    }
});

// ===== CONTINUATION FROM app.post('/api/fee-certificates'...) =====

app.post('/api/fee-certificates', async (req, res) => {
    try {
        console.log('📜 Fee Certificate generation request');
        console.log('Body:', req.body);
        
        let { studentCode, amountPaid, remarks, generatedBy } = req.body;
        
        studentCode = sanitizeInput(studentCode);
        remarks = sanitizeInput(remarks) || '';
        
        if (!['admin', 'receptionist'].includes(generatedBy)) {
            return res.status(403).json({ error: 'Invalid user type for fee certificate generation' });
        }
        
        if (!studentCode || amountPaid === undefined) {
            return res.status(400).json({ error: 'Student code and amount paid are required' });
        }

        amountPaid = parseFloat(amountPaid);
        if (isNaN(amountPaid) || amountPaid <= 0) {
            return res.status(400).json({ error: 'Invalid amount paid' });
        }

        const data = await readData();
        
        if (!data.studentMasterRecords) {
            return res.status(404).json({ error: 'No student records found' });
        }
        
        const upperStudentCode = studentCode.toUpperCase();
        const studentRecord = data.studentMasterRecords[upperStudentCode];
        
        if (!studentRecord) {
            return res.status(404).json({ error: 'Student not found. Please register the student first.' });
        }
        
        // Validate payment amount
        if (amountPaid > studentRecord.currentDue) {
            return res.status(400).json({ 
                error: `Amount paid (₹${amountPaid}) exceeds current due (₹${studentRecord.currentDue})` 
            });
        }
        
        // Calculate new balance
        const newDue = studentRecord.currentDue - amountPaid;
        const totalPaid = studentRecord.totalFee - newDue;
        
        // Create certificate
        if (!data.feeCertificates) {
            data.feeCertificates = [];
        }
        
        if (!data.studentFeeCertificates) {
            data.studentFeeCertificates = {};
        }
        
        const certificate = {
            id: `FEE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            studentCode: upperStudentCode,
            studentName: studentRecord.studentName,
            fatherName: studentRecord.fatherName,
            studentClass: studentRecord.studentClass,
            studentRoll: studentRecord.studentRoll,
            totalFee: studentRecord.totalFee,
            amountPaid: amountPaid,
            previousDue: studentRecord.currentDue,
            remainingDue: newDue,
            totalPaidToDate: totalPaid,
            academicYear: studentRecord.academicYear,
            remarks: remarks,
            generatedBy: generatedBy,
            generatedAt: new Date().toISOString(),
            status: 'issued' // Always issued immediately
        };
        
        // Update student master record
        studentRecord.currentDue = newDue;
        studentRecord.lastUpdated = certificate.generatedAt;
        data.studentMasterRecords[upperStudentCode] = studentRecord;
        
        // Add to feeCertificates array (visible to both admin and receptionist)
        data.feeCertificates.push(certificate);
        
        // Add to studentFeeCertificates (visible to student)
        if (!data.studentFeeCertificates[upperStudentCode]) {
            data.studentFeeCertificates[upperStudentCode] = [];
        }
        data.studentFeeCertificates[upperStudentCode].push(certificate);
        
        // Add to history
        addToHistory(data, 'fee-certificate-generated', generatedBy, {
            text: `Fee certificate: ${studentRecord.studentName} (${upperStudentCode}) - Paid: ₹${amountPaid}, Due: ₹${newDue}`,
            date: certificate.generatedAt
        });
        
        if (await writeData(data)) {
            console.log('✅ Fee certificate generated and issued:', certificate.id);
            res.json({ 
                success: true, 
                certificate: certificate,
                newBalance: {
                    currentDue: newDue,
                    totalPaid: totalPaid,
                    totalFee: studentRecord.totalFee
                }
            });
        } else {
            res.status(500).json({ error: 'Failed to save fee certificate' });
        }
    } catch (error) {
        console.error('❌ Fee certificate generation error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// 4. Get all fee certificates (Admin view - ALL certificates)
app.get('/api/admin/fee-certificates', async (req, res) => {
    try {
        setNoCacheHeaders(res);
        console.log('📋 Admin requesting all fee certificates');
        const data = await readData();
        
        if (!data.feeCertificates) data.feeCertificates = [];
        
        // Return ALL certificates sorted by date
        const allCertificates = data.feeCertificates.sort((a, b) => 
            new Date(b.generatedAt) - new Date(a.generatedAt)
        );
        
        console.log(`✅ Returning ${allCertificates.length} fee certificates to admin`);
        res.json(allCertificates);
    } catch (error) {
        console.error('❌ Error fetching admin fee certificates:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Get all fee certificates (Receptionist view - ALL certificates)
app.get('/api/receptionist/fee-certificates', async (req, res) => {
    try {
        setNoCacheHeaders(res);
        console.log('📋 Receptionist requesting all fee certificates');
        const data = await readData();
        
        if (!data.feeCertificates) data.feeCertificates = [];
        
        // Return ALL certificates sorted by date (same as admin)
        const allCertificates = data.feeCertificates.sort((a, b) => 
            new Date(b.generatedAt) - new Date(a.generatedAt)
        );
        
        console.log(`✅ Returning ${allCertificates.length} fee certificates to receptionist`);
        res.json(allCertificates);
    } catch (error) {
        console.error('❌ Error fetching receptionist fee certificates:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. Get all registered students (Admin & Receptionist)
app.get('/api/registered-students', async (req, res) => {
    try {
        setNoCacheHeaders(res);
        const data = await readData();
        
        if (!data.studentMasterRecords) {
            return res.json([]);
        }
        
        // Convert object to array
        const students = Object.values(data.studentMasterRecords);
        
        // Sort by student code
        students.sort((a, b) => a.studentCode.localeCompare(b.studentCode));
        
        res.json(students);
    } catch (error) {
        console.error('❌ Error fetching registered students:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Delete single fee certificate (Admin only)
app.delete('/api/admin/delete-fee-certificate/:certificateId', async (req, res) => {
    try {
        console.log('🗑️ Admin deleting fee certificate:', req.params.certificateId);
        
        const { certificateId } = req.params;
        
        if (!certificateId) {
            return res.status(400).json({ error: 'Certificate ID is required' });
        }

        const data = await readData();
        if (!data.feeCertificates) data.feeCertificates = [];
        
        const certIndex = data.feeCertificates.findIndex(cert => cert.id === certificateId);
        
        if (certIndex === -1) {
            return res.status(404).json({ error: 'Fee certificate not found' });
        }
        
        const deletedCert = data.feeCertificates.splice(certIndex, 1)[0];
        
        // Remove from student's certificates
        if (data.studentFeeCertificates && deletedCert.studentCode) {
            const studentCode = deletedCert.studentCode.toUpperCase();
            if (data.studentFeeCertificates[studentCode]) {
                data.studentFeeCertificates[studentCode] = data.studentFeeCertificates[studentCode].filter(
                    cert => cert.id !== certificateId
                );
                
                if (data.studentFeeCertificates[studentCode].length === 0) {
                    delete data.studentFeeCertificates[studentCode];
                }
            }
        }
        
        addToHistory(data, 'fee-certificate-deleted', 'admin', {
            text: `Fee certificate deleted: ${deletedCert.studentName} (${deletedCert.studentCode}) - ₹${deletedCert.amountPaid}`,
            date: new Date().toISOString()
        });
        
        if (await writeData(data)) {
            console.log('✅ Fee certificate deleted:', certificateId);
            res.json({ success: true, message: 'Fee certificate deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete fee certificate' });
        }
    } catch (error) {
        console.error('❌ Error deleting fee certificate:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 8. Delete all fee certificates (Admin only)
app.delete('/api/admin/delete-all-fee-certificates', async (req, res) => {
    try {
        console.log('🗑️ Admin deleting ALL fee certificates');
        
        const data = await readData();
        const deletedCount = data.feeCertificates ? data.feeCertificates.length : 0;
        
        // Clear both arrays
        data.feeCertificates = [];
        data.studentFeeCertificates = {};
        
        addToHistory(data, 'all-fee-certificates-deleted', 'admin', {
            text: `All fee certificates deleted (${deletedCount} certificates)`,
            date: new Date().toISOString()
        });
        
        if (await writeData(data)) {
            console.log(`✅ All ${deletedCount} fee certificates deleted`);
            res.json({ 
                success: true, 
                message: 'All fee certificates deleted successfully',
                deletedCount: deletedCount
            });
        } else {
            res.status(500).json({ error: 'Failed to delete fee certificates' });
        }
    } catch (error) {
        console.error('❌ Error deleting all fee certificates:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 9. Get student's fee certificates (Student view - ONLY issued ones)
app.get('/api/student-fee-certificates/:studentCode', async (req, res) => {
    try {
        console.log('📜 Student requesting fee certificates:', req.params.studentCode);
        
        const { studentCode } = req.params;
        const sanitizedStudentCode = sanitizeInput(studentCode);
        
        if (!sanitizedStudentCode) {
            return res.status(400).json({ error: 'Student code is required' });
        }
        
        const data = await readData();
        
        if (!data.studentFeeCertificates) data.studentFeeCertificates = {};
        
        const parsedCode = parseStudentCode(sanitizedStudentCode);
        if (!parsedCode) {
            return res.status(400).json({ error: 'Invalid student code format' });
        }
        
        // Get issued certificates for this student
        const studentFeeCertificates = data.studentFeeCertificates[sanitizedStudentCode.toUpperCase()] || [];
        
        studentFeeCertificates.sort((a, b) => 
            new Date(b.generatedAt) - new Date(a.generatedAt)
        );
        
        console.log(`✅ Returning ${studentFeeCertificates.length} certificates for student ${sanitizedStudentCode}`);
        res.json(studentFeeCertificates);
    } catch (error) {
        console.error('❌ Error fetching student fee certificates:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== END FEE CERTIFICATE SYSTEM =====

// ===== HALL TICKET SYSTEM (ALL PRESERVED) =====

app.post('/api/admin/create-hall-ticket', async (req, res) => {
    try {
        const hallTicketData = req.body;
        
        if (!hallTicketData.examName || !hallTicketData.studentCode || 
            !hallTicketData.studentName || !hallTicketData.studentClass || 
            !hallTicketData.studentRoll || !hallTicketData.fromDate || 
            !hallTicketData.toDate || !hallTicketData.examSchedule) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        const fromDate = new Date(hallTicketData.fromDate);
        const toDate = new Date(hallTicketData.toDate);
        if (toDate < fromDate) {
            return res.status(400).json({ error: 'End date cannot be before start date' });
        }

        if (!Array.isArray(hallTicketData.examSchedule) || hallTicketData.examSchedule.length === 0) {
            return res.status(400).json({ error: 'Exam schedule must be provided' });
        }

        const data = await readData();
        if (!data.hallTickets) data.hallTickets = [];
        
        const hallTicket = {
            ...hallTicketData,
            createdAt: new Date().toISOString(),
            status: hallTicketData.status || 'pending'
        };
        
        data.hallTickets.push(hallTicket);
        
        addToHistory(data, 'hall-ticket-created', 'admin', {
            text: `Hall Ticket created: ${hallTicket.studentName} (${hallTicket.studentCode}) - ${hallTicket.examName}`,
            date: hallTicket.createdAt
        });
        
        if (await writeData(data)) {
            console.log('Hall ticket created:', hallTicket);
            res.json({ success: true, hallTicket: hallTicket });
        } else {
            res.status(500).json({ error: 'Failed to save hall ticket' });
        }
    } catch (error) {
        console.error('Error creating hall ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/hall-tickets', async (req, res) => {
    try {
        setNoCacheHeaders(res);
        const data = await readData();
        
        if (!data.hallTickets) {
            data.hallTickets = [];
        }
        
        const hallTickets = data.hallTickets.sort((a, b) => 
            new Date(b.createdAt || b.issuedDate || 0) - new Date(a.createdAt || a.issuedDate || 0)
        );
        
        res.json(hallTickets);
    } catch (error) {
        console.error('Error fetching hall tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/issue-hall-ticket', async (req, res) => {
    try {
        const { hallTicketId, studentCode, issuedDate } = req.body;
        
        if (!hallTicketId || !studentCode) {
            return res.status(400).json({ error: 'Hall ticket ID and student code are required' });
        }

        const data = await readData();
        if (!data.hallTickets) data.hallTickets = [];
        if (!data.studentHallTickets) data.studentHallTickets = {};
        
        const hallTicket = data.hallTickets.find(ticket => ticket.hallTicketId === hallTicketId);
        if (!hallTicket) {
            return res.status(404).json({ error: 'Hall ticket not found' });
        }
        
        hallTicket.status = 'issued';
        hallTicket.issuedDate = issuedDate || new Date().toISOString();
        
        if (!data.studentHallTickets[studentCode]) {
            data.studentHallTickets[studentCode] = [];
        }
        
        const existingIndex = data.studentHallTickets[studentCode].findIndex(
            ticket => ticket.hallTicketId === hallTicketId
        );
        
        if (existingIndex >= 0) {
            data.studentHallTickets[studentCode][existingIndex] = hallTicket;
        } else {
            data.studentHallTickets[studentCode].push(hallTicket);
        }
        
        addToHistory(data, 'hall-ticket-issued', 'admin', {
            text: `Hall Ticket issued to student: ${hallTicket.studentName} (${studentCode}) - ${hallTicket.examName}`,
            date: hallTicket.issuedDate
        });
        
        if (await writeData(data)) {
            console.log('Hall ticket issued:', hallTicketId, studentCode);
            res.json({ success: true, message: 'Hall ticket issued successfully' });
        } else {
            res.status(500).json({ error: 'Failed to issue hall ticket' });
        }
    } catch (error) {
        console.error('Error issuing hall ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/delete-hall-ticket/:hallTicketId', async (req, res) => {
    try {
        const { hallTicketId } = req.params;
        
        if (!hallTicketId) {
            return res.status(400).json({ error: 'Hall ticket ID is required' });
        }

        const data = await readData();
        if (!data.hallTickets) data.hallTickets = [];
        
        const ticketIndex = data.hallTickets.findIndex(ticket => ticket.hallTicketId === hallTicketId);
        
        if (ticketIndex === -1) {
            return res.status(404).json({ error: 'Hall ticket not found' });
        }
        
        const deletedTicket = data.hallTickets.splice(ticketIndex, 1)[0];
        
        if (data.studentHallTickets && deletedTicket.studentCode) {
            const studentCode = deletedTicket.studentCode;
            if (data.studentHallTickets[studentCode]) {
                data.studentHallTickets[studentCode] = data.studentHallTickets[studentCode].filter(
                    ticket => ticket.hallTicketId !== hallTicketId
                );
            }
        }
        
        addToHistory(data, 'hall-ticket-deleted', 'admin', {
            text: `Hall Ticket deleted: ${deletedTicket.studentName}`,
            date: new Date().toISOString()
        });
        
        if (await writeData(data)) {
            res.json({ success: true, message: 'Hall ticket deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete hall ticket' });
        }
    } catch (error) {
        console.error('Error deleting hall ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/delete-all-hall-tickets', async (req, res) => {
    try {
        const data = await readData();
        const deletedCount = data.hallTickets ? data.hallTickets.length : 0;
        
        data.hallTickets = [];
        data.studentHallTickets = {};
        
        addToHistory(data, 'all-hall-tickets-deleted', 'admin', {
            text: `All hall tickets deleted (${deletedCount} tickets)`,
            date: new Date().toISOString()
        });
        
        if (await writeData(data)) {
            console.log(`All ${deletedCount} hall tickets deleted`);
            res.json({ 
                success: true, 
                message: 'All hall tickets deleted successfully',
                deletedCount: deletedCount
            });
        } else {
            res.status(500).json({ error: 'Failed to delete hall tickets' });
        }
    } catch (error) {
        console.error('Error deleting all hall tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/student-hall-tickets/:studentCode', async (req, res) => {
    try {
        const { studentCode } = req.params;
        const sanitizedStudentCode = sanitizeInput(studentCode);
        
        if (!sanitizedStudentCode) {
            return res.status(400).json({ error: 'Student code is required' });
        }
        
        const data = await readData();
        
        if (!data.studentHallTickets) data.studentHallTickets = {};
        
        const studentHallTickets = data.studentHallTickets[sanitizedStudentCode.toUpperCase()] || [];
        
        studentHallTickets.sort((a, b) => 
            new Date(b.issuedDate || b.createdAt || 0) - new Date(a.issuedDate || a.createdAt || 0)
        );
        
        res.json(studentHallTickets);
    } catch (error) {
        console.error('Error fetching student hall tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== END HALL TICKET SYSTEM =====

// Get student-specific data (UPDATED to use new fee certificate system)
app.get('/api/student-data/:studentCode', async (req, res) => {
    try {
        const { studentCode } = req.params;
        const sanitizedStudentCode = sanitizeInput(studentCode);
        
        if (!sanitizedStudentCode) {
            return res.status(400).json({ error: 'Student code is required' });
        }
        
        let data = await readData();
        data = cleanExpiredPosts(data);
        
        const parsedCode = parseStudentCode(sanitizedStudentCode);
        if (!parsedCode) {
            return res.status(400).json({ error: 'Invalid student code format' });
        }
        
        const { classCode, rollNumber } = parsedCode;
        
        const classFacultyPosts = data.facultyPosts[classCode] || {
            homework: [],
            assignment: [],
            subject: []
        };
        
        const classAssignments = data.assignments[classCode] || [];
        
        const studentAssignmentResults = {};
        classAssignments.forEach(assignment => {
            const results = data.assignmentResults[assignment.id] || [];
            const studentResult = results.find(r => r.studentCode === sanitizedStudentCode.toUpperCase());
            if (studentResult) {
                studentAssignmentResults[assignment.id] = studentResult;
            }
        });
        
        const classProgressCards = data.progressCards[classCode] || [];
        const studentProgressCards = classProgressCards.filter(
            card => card.rollNumber === rollNumber || card.studentCode === sanitizedStudentCode.toUpperCase()
        );
        
        const studentAttendance = data.monthlyAttendance.filter(
            record => record.studentCode === sanitizedStudentCode.toUpperCase()
        );
        
        // Get issued certificates from studentFeeCertificates
        const studentFeeCertificates = (data.studentFeeCertificates && data.studentFeeCertificates[sanitizedStudentCode.toUpperCase()]) || [];
        
        const studentHallTickets = (data.studentHallTickets && data.studentHallTickets[sanitizedStudentCode.toUpperCase()]) || [];
        
        const studentData = {
            studentInfo: {
                code: sanitizedStudentCode.toUpperCase(),
                class: classCode,
                rollNumber: rollNumber,
                type: parsedCode.type
            },
            facultyPosts: classFacultyPosts,
            assignments: classAssignments,
            assignmentResults: studentAssignmentResults,
            progressCards: studentProgressCards,
            monthlyAttendance: studentAttendance,
            feeCertificates: studentFeeCertificates,
            hallTickets: studentHallTickets
        };
        
        res.json(studentData);
    } catch (error) {
        console.error('❌ Error fetching student data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('=== Error Middleware ===');
    console.error('Error:', error);
    
    if (error instanceof multer.MulterError) {
        console.error('Multer error code:', error.code);
        
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false,
                error: 'File too large. Maximum size is 10MB.' 
            });
        }
        
        return res.status(400).json({ 
            success: false,
            error: `File upload error: ${error.message}` 
        });
    }
    
    if (error.message === 'Only images, PDFs, and documents are allowed') {
        return res.status(400).json({ 
            success: false,
            error: error.message 
        });
    }
    
    console.error('Unhandled error:', error);
    
    if (!res.headersSent) {
        return res.status(500).json({ 
            success: false,
            error: 'Internal server error: ' + error.message 
        });
    }
});

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/schoollogin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'schoollogin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/faculty.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'faculty.html'));
});

app.get('/student.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'student.html'));
});

app.get('/guestlogin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'guestlogin.html'));
});

app.get('/receptionist.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'receptionist.html'));
});

// Handle 404 errors
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Initialize data and start server
async function startServer() {
    try {
        await ensureUploadsDir();
        await initializeData();
        console.log('✅ Data initialized successfully');
        
        app.listen(PORT, () => {
            console.log(`\n🚀 Server running at http://localhost:${PORT}`);
            console.log('\n==== NEW FEE CERTIFICATE SYSTEM ACTIVE ====');
            console.log('✅ Direct Issue System (No Approval Required)');
            console.log('✅ Both Admin & Receptionist can generate certificates');
            console.log('✅ Running balance tracking per student');
            console.log('✅ All certificates visible to both roles');
            console.log('\n==== FEE CERTIFICATE ENDPOINTS ====');
            console.log('POST   /api/register-student - Register student (Receptionist)');
            console.log('GET    /api/student-balance/:code - Get current balance');
            console.log('POST   /api/fee-certificates - Generate & issue certificate (Both)');
            console.log('GET    /api/admin/fee-certificates - Get all certificates (Admin)');
            console.log('GET    /api/receptionist/fee-certificates - Get all certificates (Receptionist)');
            console.log('GET    /api/registered-students - Get all registered students');
            console.log('DELETE /api/admin/delete-fee-certificate/:id - Delete single (Admin)');
            console.log('DELETE /api/admin/delete-all-fee-certificates - Delete all (Admin)');
            console.log('GET    /api/student-fee-certificates/:code - Student view');
            console.log('\n✨ Server ready! New fee certificate system fully operational! ✨\n');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
