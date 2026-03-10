FROM node:22-slim
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY dist/ ./dist/
COPY openclippy.mjs ./

# Create non-root user
RUN adduser --disabled-password --gecos '' clippy
USER clippy

# Config volume
VOLUME /home/clippy/.openclippy

ENTRYPOINT ["node", "openclippy.mjs"]
CMD ["--help"]
