# syntax=docker/dockerfile:1
# KickTick Contracts — Rust 1.96 + Solana 3.1.10 + Anchor 1.0.2
# Build: docker build -t kicktick-contracts .
# Run:  docker run --rm -it -v $(pwd):/workspace -v ~/.config/solana:/home/pdpvs/.config/solana kicktick-contracts bash

FROM ubuntu:24.04

ARG USER_ID=1000
ARG GROUP_ID=1000
ARG USER_NAME=pdpvs

ENV DEBIAN_FRONTEND=noninteractive
ENV RUST_VERSION=1.96.0
ENV SOLANA_VERSION=3.1.10
ENV ANCHOR_VERSION=1.0.2
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV AVM_HOME=/usr/local/anchor
ENV PATH="/usr/local/cargo/bin:/usr/local/solana/active_release/bin:/usr/local/anchor:${PATH}"

# Install system deps
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    pkg-config \
    libudev-dev \
    libsqlite3-dev \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Rust via rustup
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain ${RUST_VERSION}
RUN rustup component add rustfmt clippy

# Install Solana CLI (Agave)
RUN curl -sSfL "https://github.com/anza-xyz/agave/releases/download/v${SOLANA_VERSION}/agave-install-init-x86_64-unknown-linux-gnu" -o agave-install-init \
    && chmod +x agave-install-init \
    && ./agave-install-init -d /usr/local/solana v${SOLANA_VERSION} \
    && rm agave-install-init

# Install Anchor CLI via avm
RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
RUN avm install ${ANCHOR_VERSION} && avm use ${ANCHOR_VERSION}

# Verify installations
RUN rustc --version && solana --version && anchor --version

RUN groupadd -g ${GROUP_ID} ${USER_NAME} \
    && useradd -m -u ${USER_ID} -g ${USER_NAME} -s /bin/bash ${USER_NAME} \
    && mkdir -p /workspace \
    && chown -R ${USER_NAME}:${USER_NAME} /workspace

USER ${USER_NAME}

WORKDIR /workspace

# Default: keep container alive for dev
CMD ["bash"]