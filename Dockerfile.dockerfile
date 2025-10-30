# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Copy package.json and package-lock.json first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all application files
COPY . .

# Expose port 3000 (as specified)
EXPOSE 3000

# Use the start script from package.json
CMD ["npm", "start"]
