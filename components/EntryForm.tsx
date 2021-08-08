import React, { FC, Fragment, useEffect, useState } from 'react'
import { NextRouter, useRouter } from 'next/router'
import { useDispatch } from 'react-redux'
import { AppDispatch } from '../store'
import { Button, Checkbox, Divider, Form, FormInstance, Input, Select, Space, Spin, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons/lib'
import isString from 'lodash/isString'
import isArray from 'lodash/isArray'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { redirectToEntityDetail } from '../utils/slug'
import { AxiosInstance } from '../api'
import useRequest from '../api/useRequest'
import API_ENDPOINTS from '../api/endpoints'
import { EntryRequest } from '../dtos/EntryRequest'
import { NewEntryWithLicense } from '../dtos/NewEntryWithLicense'
import { NewEntryWithVersion } from '../dtos/NewEntryWithVersion'
import { Entries as EntriesDTO, Entry } from '../dtos/Entry'
import { convertNewEntryToSearchEntry, SearchEntryID } from '../dtos/SearchEntry'
import Point from '../dtos/Point'
import { RouterQueryParam, SlugVerb } from '../utils/types'
import { ExtendedGeocodeAddress, getCityFromAddress, reverseGeocode } from '../utils/geolocation'
import Category from '../dtos/Categories'
import { entriesActions } from '../slices'
import { renameProperties, setValuesToDefaultOrNull, transformObject } from '../utils/objects'
import { isValidPhoneNumber } from 'libphonenumber-js'
import { validate as isValidEmail } from 'isemail'
import TagsSelect from './TagsSelect'
import { NewEntry } from '../dtos/NewEntry'
import DuplicateListModal from './DuplicateListModal'


const { useForm } = Form
const { TextArea } = Input
const { Link } = Typography


// we declare both types NewEntryWithLicense for create, and NewEntryWithVersion for update
export type EntryFormType = NewEntryWithLicense | NewEntryWithVersion

export interface DuplicatePayload extends NewEntry {
  id: string | null
  license: string | string[]
  links: string[]
  version: number
  contact: string
  custom_links?: string
}

const setAddressDetails = async (form: FormInstance, newPoint: Point) => {
  const place = await reverseGeocode(newPoint.toJson())
  const address = place.address as ExtendedGeocodeAddress

  // it's not an error, town and road are optional fields than are not included in the interface
  // but can exist in the response from nominatim
  form.setFieldsValue({
    lat: newPoint.lat,
    lng: newPoint.lng,
    country: address.country,
    city: getCityFromAddress(address),
    state: address.state,
    street: address.road,
    zip: address.postcode,
  })

}

const setFieldsToDefaultOrNull = (entry: EntryFormType): EntryFormType => {
  const defaultFieldValues = {
    tags: [],
    custom_links: [],
    version: 0,
  }

  const entryFormWithDefaultValues = setValuesToDefaultOrNull(entry, defaultFieldValues)

  return entryFormWithDefaultValues
}


const transformFormFields = (entry: EntryFormType): EntryFormType => {
  // the licence should get fetched from the array
  // the version should raise by 1
  const rules = {
    version: (version: number): number => version + 1,
    license: (licenseArray: string[]): string => {
      if (licenseArray.length === 0) {
        return ''
      }

      return licenseArray[0]
    },
  }

  const fieldsToRename = {
    custom_links: 'links',
  }

  const transformedEntry = transformObject(entry, rules)
  const transformedEntryWithRenamedFields = renameProperties(transformedEntry, fieldsToRename)

  return transformedEntryWithRenamedFields
}


// todo: it's an awful ani-pattern to shake the map to retrieve the entry
// todo: create a class for the changing the router
// todo: create a thunk for prepending the entry to the collection
const redirectToEntry = (router: NextRouter, entryId: SearchEntryID) => {
  // gotcha: the categories of initiative and company both are mapped to entity so it does not matter
  // what we pass as the category
  // if at any time we decided to make them separate here is the point to touch
  redirectToEntityDetail(
    router,
    entryId,
    Category.INITIATIVE,
    2,
    ['pinLat', 'pinLng'],
  )
}


const addEntryToState = (
  id: SearchEntryID,
  entry: EntryFormType,
  dispatch: AppDispatch,
) => {
  const searchEntry = convertNewEntryToSearchEntry(id, entry)
  dispatch(entriesActions.prependEntry(searchEntry))
}

const onCreate = async (entry: NewEntryWithLicense): Promise<SearchEntryID> => {
  // todo: catch errors and show notifications if an error happened

  const response = await AxiosInstance.PostRequest<SearchEntryID>(
    API_ENDPOINTS.postEntries(),
    entry,
  )

  return response.data
}

const onEdit = async (
  entry: NewEntryWithVersion,
  entryId: SearchEntryID,
) => {
  // todo: catch errors and show notifications if an error happened
  await AxiosInstance.PutRequest<SearchEntryID>(
    `${API_ENDPOINTS.postEntries()}/${entryId}`,
    entry,
  )
}

const createOrEditEntry = async (
  entry: EntryFormType,
  entryId: SearchEntryID,
  isEdit: boolean,
): Promise<SearchEntryID> => {
  if (isEdit) {
    await onEdit(entry as NewEntryWithVersion, entryId)
  } else {
    entryId = await onCreate(entry as NewEntryWithLicense)
  }

  return entryId
}

const addEntryToStateOnCreate = (
  isEdit: boolean,
  id: SearchEntryID,
  entry: EntryFormType,
  dispatch: AppDispatch,
) => {
  if (isEdit) {
    return
  }

  addEntryToState(id, entry, dispatch)
}



type EntryCategories = Category.COMPANY | Category.INITIATIVE

interface EntryFormProps {
  category: EntryCategories
  verb: SlugVerb.EDIT | SlugVerb.CREATE
  entryId?: SearchEntryID
}

const EntryForm: FC<EntryFormProps> = (props) => {
  const [showModal, setShowModal] = useState(false)
  const [duplicate, setDuplicate] = useState<DuplicatePayload[]>([])
  const [formData, setFormData] = useState({} as EntryFormType)
  // todo: for a better experience show spinner with the corresponding message when the form is loading
  // for example: fetching the address
  const { category, verb, entryId } = props

  const dispatch = useDispatch()

  const router = useRouter()
  const { query } = router

  const [form] = useForm<EntryFormType>()

  const newPoint = new Point().fromQuery(query)

  const effectDeps = [...newPoint.toArray()]

  // set address information if the map marker/pin moves
  useEffect(() => {
    if (!newPoint.isEmpty()) {
      setAddressDetails(form, newPoint).then()
    }

  }, effectDeps)

  const isEdit = verb === SlugVerb.EDIT

  const optionalOrgTag: RouterQueryParam = query['org-tag']
  const orgTag = optionalOrgTag && isString(optionalOrgTag) ? optionalOrgTag : null
  const entryRequest: EntryRequest = {
    org_tag: orgTag,
  }

  const { data: entries, error: entriesError } = useRequest<EntriesDTO>(isEdit && {
    url: `${API_ENDPOINTS.getEntries()}/${entryId}`,
    params: entryRequest,
  })


  const foundEntry: boolean = isArray(entries) && entries.length !== 0
  const entry: Entry = foundEntry ? entries[0] : {} as Entry
  //it's an overwrite to be sure it's not empty for the new entries
  entry.categories = [category]

  const checkDuplicateEntries = async (entry: NewEntryWithLicense): Promise<DuplicatePayload[]> => {
    const { title, description, city, zip, country, state, street, lat, lng, telephone, email } = entry
    const license = Array.isArray(entry.license) ? entry.license.join('') : entry.license
    const duplicate: DuplicatePayload = {
      title,
      description,
      city,
      zip,
      country,
      state,
      street,
      lat,
      lng,
      telephone,
      email,
      id: null,
      homepage: null,
      tags: [],
      image_url: null,
      image_link_url: null,
      opening_hours: null,
      links: [],
      version: 1,
      contact: null,
      categories: [],
      license,
    }
    const res = await AxiosInstance.PostRequest<DuplicatePayload[]>(
      API_ENDPOINTS.checkForDuplicate(),
      duplicate,
    )
    return res.data
  }

  const createNewEntry = async(
    entry: EntryFormType,
    router: NextRouter,
    dispatch: AppDispatch,
    isEdit: boolean,
    entryId: SearchEntryID,
  ) => {
    const entryWithDefaultValues = setFieldsToDefaultOrNull(entry)
    const adaptedEntry = transformFormFields(entryWithDefaultValues)

    entryId = await createOrEditEntry(adaptedEntry, entryId, isEdit)

    addEntryToStateOnCreate(isEdit, entryId, adaptedEntry, dispatch)
    redirectToEntry(router, entryId)
  }

  const onFinish = (
    router: NextRouter,
    dispatch: AppDispatch,
    isEdit: boolean,
    entryId: SearchEntryID,
  ) => async (entry: EntryFormType) => {
    // todo: if failed then show a notification
    setFormData(entry)
    const duplicate = await checkDuplicateEntries(entry)
    if (duplicate.length > 0) {
      setShowModal(true)
      setDuplicate(duplicate)
    } else {
      await createNewEntry(entry, router, dispatch, isEdit, entryId)
    }
  }

  const HandlerModal = () => {
    createNewEntry(formData, router, dispatch, isEdit, entryId)
  }

  if (entriesError) {
    //  todo: show error notification, redirect to the search result view
    return null
  }

  // still loading
  if (!entries && isEdit) {
    return (
      <div className='center'>
        <Spin size='large' />
      </div>
    )
  }

  if (!foundEntry && isEdit) {
    //  todo: show not found notification, redirect to the search view
    return null
  }

  return (

    <Form
      layout='vertical'
      size='middle'
      style={{
        marginTop: 8,
      }}
      initialValues={entry}
      onFinish={onFinish(router, dispatch, isEdit, entryId)}
      form={form}
    >
        <DuplicateListModal
          duplicate={duplicate}
          showModal={showModal}
          setShowModal={setShowModal}
          HandlerModal={HandlerModal}
        />

      <Divider orientation='left'>Location</Divider>

      <Form.Item>
        <Input.Group compact>
          <Form.Item
            name={'city'}
            noStyle
          >
            <Input style={{ width: '50%' }} placeholder='City' />
          </Form.Item>
          <Form.Item
            name={'zip'}
            noStyle
          >
            <Input style={{ width: '50%' }} placeholder='Zip' />
          </Form.Item>
        </Input.Group>
      </Form.Item>

      <Form.Item name='country' hidden />

      <Form.Item name='state' hidden />

      <Form.Item name='street'>
        <Input placeholder='Address' />
      </Form.Item>

      <Form.Item
        name='lat'
        style={{
          display: 'inline-block',
          width: '50%',
        }}
      >
        <Input placeholder='Latitude' disabled />
      </Form.Item>

      <Form.Item
        name='lng'
        style={{
          display: 'inline-block',
          width: '50%',
        }}
      >
        <Input placeholder='Longitude' disabled />
      </Form.Item>

      <Form.Item name='id' hidden>
        <Input disabled />
      </Form.Item>

      {/*the backend accepts an array that's because it's named plural*/}
      {/* but in reality it contains only one category*/}
      {/*and the value is initialized by the parent not the api in the edit mode*/}
      <Form.Item name='categories' hidden>
        <Select
          mode='multiple'
          disabled
        />
      </Form.Item>

      <Divider orientation='left'>Title</Divider>

      <Form.Item
        name='title'
        rules={[{ required: true, min: 3 }]}
      >
        <Input placeholder='Title' />
      </Form.Item>

      <Form.Item
        name='description'
        rules={[{ required: true, min: 10, max: 250 }]}
      >
        <TextArea placeholder='Description' />
      </Form.Item>

      <Divider orientation='left'>Tags</Divider>
      {/*add validation for the three tags*/}
      <Form.Item name='tags'>
        <TagsSelect />
      </Form.Item>

      <Divider orientation='left'>Contact</Divider>

      <Form.Item name='contact'>
        <Input placeholder='Contact Person' prefix={<FontAwesomeIcon icon='user' />} />
      </Form.Item>

      <Form.Item
        name='telephone'
        rules={[
          {
            validator: (_, value) => (
              isValidPhoneNumber(value) ?
                Promise.resolve() :
                Promise.reject('not a valid telephone number')
            ),
          },
        ]}
      >
        <Input placeholder='Phone' prefix={<FontAwesomeIcon icon='phone' />} />
      </Form.Item>

      <Form.Item
        name='email'
        rules={[
          {
            validator: (_, value) => (
              isValidEmail(value) ?
                Promise.resolve() :
                Promise.reject('not a valid email')
            ),
          },
        ]}
      >
        <Input placeholder='Email' prefix={<FontAwesomeIcon icon='envelope' />} />
      </Form.Item>

      <Form.Item name='homepage'>
        <Input placeholder='homepage' prefix={<FontAwesomeIcon icon='globe' />} />
      </Form.Item>

      <Form.Item name='opening_hours'>
        <Input placeholder='Opening Hours' prefix={<FontAwesomeIcon icon='clock' />} />
      </Form.Item>

      <div style={{ width: '100%', textAlign: 'center' }}>
        <Link
          href={process.env.NEXT_PUBLIC_OPENING_HOURS}
          target='_blank'
        >
          Find out the right format for your time
        </Link>
      </div>

      <Divider orientation='left'>Links and Social Media</Divider>

      <Form.List name='custom_links'>
        {(fields, { add, remove }) => (
          <Fragment>
            {fields.map(field => (
              <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align='baseline'>
                <Form.Item
                  {...field}
                  name={[field.name, 'first']}
                  fieldKey={[field.fieldKey, 'first']}
                >
                  <Input placeholder='First Name' />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'last']}
                  fieldKey={[field.fieldKey, 'last']}
                >
                  <Input placeholder='Last Name' />
                </Form.Item>
                <MinusCircleOutlined onClick={() => remove(field.name)} />
              </Space>
            ))}
            <Form.Item>
              <Button type='dashed' onClick={() => add()} block icon={<PlusOutlined />}>
                Add field
              </Button>
            </Form.Item>
          </Fragment>
        )}
      </Form.List>

      <Divider orientation='left'>Image</Divider>

      <Form.Item name='image_url'>
        <Input placeholder='URL of an image' prefix={<FontAwesomeIcon icon='camera' />} />
      </Form.Item>

      <Form.Item name='image_link_url'>
        <Input placeholder='Link' prefix={<FontAwesomeIcon icon='link' />} />
      </Form.Item>

      <Divider orientation='left'>License</Divider>

      <Form.Item
        name='license'
        rules={[{ required: true }]}
        valuePropName='value'
      >
        {/*it's necessary to catch the value of the checkbox, but the out come will be a list*/}
        {/*so we should grab the first element*/}
        <Checkbox.Group
          options={[
            {
              label: <Fragment>
                {`I have read and accept the Terms of the `}
                <Link
                  href={process.env.NEXT_PUBLIC_CC_LINK}
                  target='_blank'
                >
                  Creative-Commons License CC0
                </Link>
              </Fragment>,
              value: 'CC0-1.0',
            },
          ]}
        />
      </Form.Item>

      <Form.Item name='version' hidden>
        <Input disabled />
      </Form.Item>

      <Button
        type='primary'
        htmlType='submit'
        style={{
          width: '100%',
        }}
      >
        Submit
      </Button>

    </Form>
  )
}

export default EntryForm