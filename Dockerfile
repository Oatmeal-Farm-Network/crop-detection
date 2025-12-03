# Stage 1: Build the React Application
# FIX: Capitalized "AS" to fix the warning
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# Stage 2: Serve the App with Nginx
FROM nginx:alpine

# FIX: Changed "/app/dist" to "/app/build" for Create React App
COPY --from=build /app/build /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]