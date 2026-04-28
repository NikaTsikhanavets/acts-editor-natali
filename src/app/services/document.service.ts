import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import PizZip from 'pizzip';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { TemplateService } from './template.service';
import { RequestInfo } from '@models';
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private readonly xmlDocumentName: string = 'word/document.xml';

  constructor(private readonly templateService: TemplateService,
              private readonly http: HttpClient) {
  }

  public importExcelFile(file: File): Promise<XLSX.WorkBook> {
    return new Promise((resolve, reject) => {
      const reader: FileReader = new FileReader();

      reader.onload = (event: ProgressEvent<FileReader>) => {
        const fileContent = event?.target?.result;
        resolve(XLSX.read(fileContent, {type: 'binary'}));
      };

      reader.onerror = () => {
        reject(new Error('Unable to read...'));
      };

      reader.readAsBinaryString(file);
    })
  }

  public createActs(items: RequestInfo[]): Promise<void> {
    return new Promise((resolve) => {
      const zip = new JSZip();
      Promise.all([
        this.getDocsByTemplate('/assets/doc-templates/act-template.docx', items, 'акт'),
        this.getDocsByTemplate('/assets/doc-templates/bill-template.docx', items, 'счет')
      ]).then(([acts, bills]) => {
        [...acts, ...bills].forEach((act) => {
          zip.file(act.name, act.content);
        });

        zip.generateAsync({type: "blob"})
          .then((content) => {
            saveAs(content, "документы.zip");
            resolve();
          });
      });
    })
  }

  private getDocsByTemplate(templateSrc: string, items: RequestInfo[], namePart: string): Promise<{ name: string, content: Blob }[]> {
    const docs: { name: string, content: Blob }[] = [];
    return new Promise<{ name: string; content: Blob }[]>((resolve, reject) => {
      fetch(templateSrc).then(res => {
        return res.blob()
      }).then(res => {
        const reader = new FileReader();
        let file = res;

        reader.onload = (e) => {
          const content = e.target?.result;

          if (!content) {
            return;
          }

          items.forEach((item: RequestInfo) => {
            const act = this.createAct(content, item);
            docs.push({name: `${item.requestNumber} ${namePart}.docx`, content: act});
          });

          resolve(docs);
        };

        reader.onerror = () => {
          reject(new Error('Unable to read...'));
        };

        reader.readAsBinaryString(file);
      });
    })
  }

  private createAct(content: string | ArrayBuffer, item: RequestInfo): Blob {
    const act = new PizZip(content);
    act.files[this.xmlDocumentName] = this.prepareAct(act.files[this.xmlDocumentName].asText(), item);
    return act.generate({type: "blob"});
  }

  private prepareAct(content: string, item: RequestInfo): PizZip.ZipObject {
    const fields = this.templateService.getActTemplateFields(item);
    Object.keys(fields).forEach(key => {
      content = content.replaceAll(key, fields[key]);
    });

    const updatedDocument = new PizZip();
    updatedDocument.file(this.xmlDocumentName, content);

    return updatedDocument.files[this.xmlDocumentName];
  }

  public getFile(): Observable<XLSX.WorkBook> {
    const key: string = '1jLH6HbB-fEDElHiOWRMjOW-pYaPoqQ7lD6oHeUt0UzA';
    return this.http.get(`https://docs.google.com/spreadsheet/ccc?key=${key}&output=xls`, { responseType: 'arraybuffer'}).pipe(
      map((data: ArrayBuffer) => XLSX.read(data, {type: 'array'}))
    );
  }
}
