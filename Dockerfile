FROM public.ecr.aws/lambda/python:3.11
RUN yum install -y gcc gcc-c++ make && yum clean all
WORKDIR /build
COPY requirements-solver.txt .
RUN pip install --no-cache-dir -r requirements-solver.txt -t /opt/python/lib/python3.11/site-packages/
COPY lambda_handler.py /var/task/lambda_handler.py
COPY AWS_LAMBDA_UPDATED_CODE.py /var/task/aws_lambda_updated_code.py
COPY public/local-solver-package/testcase_gui.py /var/task/testcase_gui.py
CMD ["lambda_handler.handler"]
