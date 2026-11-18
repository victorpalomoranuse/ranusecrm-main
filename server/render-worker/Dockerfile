# Imagen del worker de render (RunPod Serverless). Se construye y se sube a un registro (Docker Hub o GHCR) y se indica en el endpoint de RunPod.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip wget xz-utils ca-certificates \
    libgl1 libegl1 libxi6 libxrender1 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libgomp1 && rm -rf /var/lib/apt/lists/*
# Versión de Blender: cambiar BLENDER_URL si se quiere otra (debe ser un .tar.xz de Linux x64 de download.blender.org)
ARG BLENDER_URL=https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz
RUN wget -q "$BLENDER_URL" -O /tmp/blender.tar.xz && mkdir /opt/blender && tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/blender.tar.xz && ln -s /opt/blender/blender /usr/local/bin/blender
RUN pip3 install --no-cache-dir runpod
WORKDIR /app
COPY render.py handler.py ./
CMD ["python3", "-u", "handler.py"]
