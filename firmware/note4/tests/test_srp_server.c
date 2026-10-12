// Synthetic host counterpart using ESP-IDF's actual SRP and Mbed TLS implementation.
#include <stdio.h>
#include <assert.h>
#include "../main/nido_pairing_key.h"
#include <stdlib.h>
#include <string.h>
#include "esp_srp.h"
#include "mbedtls/gcm.h"
static void hex(const void* ptr,int n){const unsigned char* p=ptr;for(int i=0;i<n;i++)printf("%02x",p[i]);puts("");fflush(stdout);}
static int read_hex(unsigned char* out,int capacity){char line[20000];if(!fgets(line,sizeof(line),stdin))return -1;size_t size=strcspn(line,"\r\n");if(size%2||size/2>(size_t)capacity)return -1;for(size_t i=0;i<size/2;i++){unsigned byte;if(sscanf(line+i*2,"%2x",&byte)!=1)return -1;out[i]=byte;}return size/2;}
int main(void){
    unsigned char zero[384]={0}, prime[]=MBEDTLS_DHM_RFC3526_MODP_3072_P_BIN;
    assert(!ValidPairingPublicKey(zero,sizeof(zero)));
    assert(!ValidPairingPublicKey(prime,sizeof(prime)));
    prime[383]--;assert(ValidPairingPublicKey(prime,sizeof(prime)));
    assert(!ValidPairingPublicKey(prime,sizeof(prime)-1));
    unsigned char A[384],M[64],proof[64],cipher[8192],plain[8192];
    int length=read_hex(A,sizeof(A));if(length!=384||!ValidPairingPublicKey(A,length))return 1;
    char *salt=NULL,*verifier=NULL,*B=NULL,*key=NULL;int verifier_len=0,B_len=0;uint16_t key_len=0;
    if(esp_srp_gen_salt_verifier("nido",4,"123456",6,&salt,16,&verifier,&verifier_len))return 2;
    esp_srp_handle_t* server=esp_srp_init(ESP_NG_3072);
    if(!server||esp_srp_set_salt_verifier(server,salt,16,verifier,verifier_len)||esp_srp_srv_pubkey_from_salt_verifier(server,&B,&B_len)||esp_srp_get_session_key(server,(char*)A,384,&key,&key_len))return 3;
    hex(salt,16);hex(B,B_len);
    if(read_hex(M,64)!=64)return 4;
    if(esp_srp_exchange_proofs(server,"nido",4,(char*)M,(char*)proof)){puts("DENIED");fflush(stdout);esp_srp_free(server);free(salt);free(verifier);return 0;}
    hex(proof,64);
    unsigned char nonce[12]={1,2,3,4,5,6,7,8,0,0,0,1};hex(nonce,12);
    mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);if(mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,(unsigned char*)key,256))return 5;
    length=read_hex(cipher,sizeof(cipher));if(length<16)return 6;
    if(mbedtls_gcm_auth_decrypt(&gcm,length-16,nonce,12,NULL,0,cipher+length-16,16,cipher,plain))return 7;
    hex(plain,length-16);nonce[11]=2;
    const char response[]="{\"ok\":true}";unsigned char out[sizeof(response)+16];
    if(mbedtls_gcm_crypt_and_tag(&gcm,MBEDTLS_GCM_ENCRYPT,strlen(response),nonce,12,NULL,0,(const unsigned char*)response,out,16,out+strlen(response)))return 8;
    hex(out,strlen(response)+16);mbedtls_gcm_free(&gcm);esp_srp_free(server);free(salt);free(verifier);return 0;
}
